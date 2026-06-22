# API IPC — ManiPDF

La "API" de esta app es el **contrato IPC** entre renderer y main, definido en
[`src/shared/ipc-contract.ts`](../src/shared/ipc-contract.ts). No hay servidor HTTP.

## Convenciones

- Cada operación es un **canal** con nombre `modulo:accion` (p. ej. `document:open`).
- Toda respuesta es un `IpcResult<T>`:
  ```ts
  type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
  ```
- Nunca se lanzan excepciones por el puente. Los errores viajan como `IpcError`
  con un `code` tipado: `CANCELLED | NOT_FOUND | INVALID_PDF | IO_ERROR | NO_DOCUMENT | UNKNOWN`.
- `CANCELLED` no es un fallo: significa que el usuario cerró un diálogo.

## Módulo `document`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `document:open` | — | `OpenDocumentDTO` |
| `document:open-path` | `{ filePath }` | `OpenDocumentDTO` |
| `document:save` | `{ id }` | `{ filePath }` |
| `document:save-as` | `{ id }` | `{ filePath }` |
| `document:metadata` | `{ id }` | `DocumentMetadataDTO` |
| `document:close` | `{ id }` | `{ id }` |

### `OpenDocumentDTO`
```ts
{
  id: string            // identifica el doc en la sesión del main
  filePath: string|null // null = documento nuevo sin guardar
  fileName: string
  pageCount: number
  dataBase64: string    // bytes del PDF, para que pdf.js lo renderice
  isDirty: boolean
}
```

### `DocumentMetadataDTO`
```ts
{
  title, author, subject, keywords,
  creator, producer,
  creationDate, modificationDate   // ISO 8601 | null
}
```

## Módulo `pages`

Índices de página **0-based**. Las operaciones que mutan el documento devuelven
el `OpenDocumentDTO` actualizado (nuevos bytes, `pageCount`, `isDirty`).

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `pages:rotate` | `{ id, pageIndices, delta }` | `OpenDocumentDTO` |
| `pages:delete` | `{ id, pageIndices }` | `OpenDocumentDTO` |
| `pages:reorder` | `{ id, order }` (permutación completa) | `OpenDocumentDTO` |
| `pages:duplicate` | `{ id, pageIndices }` | `OpenDocumentDTO` |
| `pages:insert` | `{ id, atIndex }` (abre diálogo para elegir PDF) | `OpenDocumentDTO` |
| `pages:extract` | `{ id, pageIndices }` (abre diálogo "guardar") | `{ filePath }` |

- `delta`: `RotationDelta = 90 | 180 | 270 | -90` (giro relativo en grados).
- `reorder` exige que `order` sea una permutación de `[0..pageCount-1]`.
- `delete` no permite borrar todas las páginas.

## Módulo `annotations`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `annotations:burn` | `{ id, annotations: Annotation[] }` | `OpenDocumentDTO` |

- Las anotaciones llegan con coordenadas **normalizadas** (0..1, origen
  arriba-izquierda); el backend las convierte a puntos PDF (origen abajo).
- Tipos: `highlight`, `underline`, `rect`, `ink`, `note`, `text` (texto visible),
  `image` (firma/imagen embebida). El backend las **aplana** en cada página.
- `annotations:pick-image` (req `void` → `{ dataBase64, format }`) abre el diálogo
  para elegir la imagen de firma antes de colocarla.

## Módulo `security`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `security:protect` | `{ id, options: ProtectOptions }` (abre diálogo "guardar") | `{ filePath }` |

`ProtectOptions = { userPassword, ownerPassword?, permissions: { printing, copying, modifying } }`.
Exporta una **copia cifrada**; no modifica el documento abierto. Implementado con
`@cantoo/pdf-lib` (`pdf-lib` no soporta cifrado al guardar).

## Módulo `optimize`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `optimize:lossless` | `{ id }` | `OpenDocumentDTO` |
| `optimize:rebuild-images` | `{ id, pages: RasterPage[] }` | `OpenDocumentDTO` |

- `lossless`: reconstruye descartando objetos huérfanos + object streams (sin pérdida).
- `rebuild-images`: el renderer rasteriza cada página a JPEG (`renderPageToJpeg`)
  y el main la reensambla con `embedJpg` (con pérdida). `RasterPage =
  { jpegBase64, widthPt, heightPt }`.
- Ambas reemplazan el documento en sesión; *Guardar* lo persiste.

## Módulo `convert`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `convert:export-images` | `{ format, images: string[] }` (base64, abre diálogo de carpeta) | `{ dir, count }` |
| `convert:images-to-pdf` | — (abre diálogos de imágenes y de guardado) | `{ filePath }` |

- `export-images`: el renderer rasteriza con `renderPageToImage` (PNG/JPG); el
  main escribe `pagina-NN.<ext>` en la carpeta elegida.
- `images-to-pdf`: íntegro en el main; `embedPng`/`embedJpg`, una página por imagen.

## Módulo `forms`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `forms:list` | `{ id }` | `FormFieldDTO[]` |
| `forms:fill` | `{ id, values: FormFieldValue[], flatten }` | `OpenDocumentDTO` |
| `forms:create` | `{ id, fields: NewFormField[] }` | `OpenDocumentDTO` |

- `create`: crea campos (`text`/`checkbox`/`dropdown`) con `form.createX().addToPage()`;
  coordenadas normalizadas → puntos PDF. `NewFormField = { type, name, page, rect, options }`.

- `list`: campos del AcroForm con tipo, valor actual y opciones.
- `fill`: escribe valores por nombre; `flatten: true` deja el formulario no editable.
- Tipos: `text`, `checkbox`, `radio`, `dropdown`, `optionlist`, `button`, `signature`.

## Módulo `ocr`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `ocr:extract` | `{ lang, images: string[] }` | `{ text }` |
| `ocr:searchable` | `{ id, lang, pages: OcrInputPage[] }` | `OpenDocumentDTO` |
| `ocr:save-text` | `{ text }` (abre diálogo guardar .txt) | `{ filePath }` |

- OCR con **tesseract.js en el main** (Node). El renderer rasteriza con
  `renderPageForOcr` (incluye dimensiones px y pt).
- `searchable`: por cada página embebe la imagen y dibuja cada palabra con
  `opacity: 0` en la posición de su bbox → texto invisible pero buscable.
- `lang`: `'spa' | 'eng'`. Primera ejecución descarga el modelo (internet).

## Módulo `stamp`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `stamp:apply` | `{ id, config: StampConfig }` | `OpenDocumentDTO` |

`StampConfig` = marca de agua (texto/opacidad/color/diagonal) + encabezado/pie
(`{ left, center, right }`) + tamaño/color/margen. En los textos se admiten los
placeholders `{page}`, `{total}`, `{date}` (sustituidos por página). Reemplaza el
documento en sesión; *Guardar* lo persiste.

## Módulo `redact`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `redact:apply` | `{ id, pages: RedactedPage[] }` | `OpenDocumentDTO` |

- El renderer rasteriza con `renderPageRedacted` cada página afectada, **quemando**
  los recuadros negros sobre la imagen → el contenido bajo el recuadro se elimina.
- El main reconstruye: páginas redactadas = imagen; resto = `copyPages` (intactas).
- `RedactedPage = { pageIndex (0-based), jpegBase64, widthPt, heightPt }`.

## Módulo `combine`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `combine:merge` | — (abre diálogos de PDFs y de guardado) | `{ filePath, pageCount }` |
| `combine:split` | `{ id, everyN }` (abre diálogo de carpeta) | `{ dir, count }` |

- `merge`: une 2+ PDF elegidos en uno nuevo (`copyPages`). Independiente del doc.
- `split`: parte el documento en archivos de `everyN` páginas (1 = una por archivo).

## Módulo `compare`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `compare:pick` | — (abre diálogo) | `{ dataBase64, fileName }` |

El main solo elige/lee el segundo PDF. El renderer extrae el texto de ambos
(`extractPageLines`, pdf.js) y calcula el diff por líneas (`services/diff.ts`, LCS)
página a página. Sin persistencia (es solo lectura/comparación).

## Módulo `separations`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `separations:render` | `{ id, pageNumber, dpi }` | `{ plates: SeparationPlate[] }` |

- El main escribe el PDF a temp y ejecuta **Ghostscript** `tiffsep` → una plancha
  TIFF gris por tinta (`plate(Cyan).tif`, …, tintas planas incluidas). Devuelve
  cada una en base64. El renderer las decodifica con `utif` y las pinta.
- **Dependencia externa:** Ghostscript (`gs`). Se busca en rutas típicas de Homebrew/MacPorts.
- `SeparationPlate = { name, tiffBase64 }`.

## Cómo se consume desde la UI

La UI **no** usa `window.api` directamente: pasa por `documentClient`
([`renderer/src/services/document.client.ts`](../src/renderer/src/services/document.client.ts)),
que desempaqueta el `IpcResult` y lanza un `ClientError` legible cuando `ok === false`.
