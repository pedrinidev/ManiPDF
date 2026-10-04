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
  con un `code` tipado: `CANCELLED | NOT_FOUND | INVALID_PDF | IO_ERROR | NO_DOCUMENT |
  WRONG_PASSWORD | DECRYPT_UNSUPPORTED | GHOSTSCRIPT_MISSING | READ_ONLY | CONFLICT | UNKNOWN`.
- Las operaciones sobre un mismo documento se ejecutan **de una en una** en el main
  (`handleExclusive`): dos a la vez ya no se pisan.
- `CONFLICT`: la operación se preparó en el renderer (rasterizando) sobre una
  versión anterior del documento (`baseRevision` ≠ `revision` actual); reintentar.
  El renderer envía como `baseRevision` la revisión del pdf.js con el que rasterizó
  (`usePdf().revision`), no la del store: justo después de una edición, el visor aún
  puede tener cargada la versión anterior.
- `CANCELLED` no es un fallo: significa que el usuario cerró un diálogo.
- `READ_ONLY`: el documento (o un PDF de origen al insertar/combinar) está protegido y
  sigue cifrado; se puede ver pero no modificar. Ver «PDFs protegidos» más abajo.

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
  data: Uint8Array      // bytes del PDF (binario, sin base64) para pdf.js
  isDirty: boolean
  readOnly: 'needs-password' | 'restricted' | 'undecryptable' | null  // null = editable
  revision: number      // versión de los bytes; sube con cada cambio
}
```

### PDFs protegidos

- Al abrir un PDF cifrado, el main intenta descifrarlo en memoria **sin pérdidas**
  (`@cantoo/pdf-lib`; Ghostscript solo como respaldo). Se edita directamente si se
  abre sin contraseña y sus permisos permiten modificarlo.
- Si pide contraseña de apertura queda `readOnly: 'needs-password'` hasta
  `document:unlock` con esa contraseña. Si sus permisos no permiten modificarlo queda
  `'restricted'` y `document:unlock` exige la contraseña de **propietario**.
- Al guardar (o exportar una copia), un documento descifrado se vuelve a cifrar con
  AES-128, la misma contraseña de apertura y los mismos permisos.
- Mientras `readOnly` no sea null, las operaciones que lo modifican responden
  `READ_ONLY` (editarlo cifrado lo corrompía).

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `document:unlock` | `{ id, password }` | `OpenDocumentDTO` |
| `document:print` | `{ id }` (abre la vista previa del SO) | `{ printed }` |
| `document:export-copy` | `{ id }` (abre diálogo "guardar") | `{ filePath }` |
| `document:restore` | `{ id, data }` (deshacer/rehacer; se valida antes de aplicar) | `OpenDocumentDTO` |

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
Exporta una **copia cifrada** (siempre AES-128); no modifica el documento abierto. Sin
contraseña de propietario se genera una aleatoria, para que los permisos se respeten.
Implementado con `@cantoo/pdf-lib` (`pdf-lib` no soporta cifrado al guardar).

## Módulo `optimize`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `optimize:lossless` | `{ id }` | `OpenDocumentDTO` |
| `optimize:rebuild-images` | `{ id, pages: RasterPage[], baseRevision }` | `OpenDocumentDTO` |

- `lossless`: reescribe el propio documento sin objetos huérfanos y con object streams;
  prueba también Ghostscript y descarta cualquier resultado que pierda formulario,
  marcadores, estructura, adjuntos o anotaciones.
- `rebuild-images`: el renderer rasteriza cada página a JPEG (`renderPageToJpeg`)
  y el main la reensambla con `embedJpg` (con pérdida). `RasterPage =
  { jpegBase64, widthPt, heightPt }`.
- Ambas reemplazan el documento en sesión; *Guardar* lo persiste.

## Módulo `convert`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `convert:begin-export` | `{ baseName, format, total }` (abre diálogo de carpeta) | `{ exportId, dir }` |
| `convert:write-image` | `{ exportId, pageNumber, data: Uint8Array }` | — |
| `convert:end-export` | `{ exportId }` | `{ dir, count }` |
| `convert:images-to-pdf` | `{ pageSize: 'letter' \| 'a4' \| 'image' }` (abre diálogos de imágenes y de guardado) | `{ filePath }` |

- Exportar a imágenes es **página a página**: `begin-export` crea una subcarpeta nueva
  (`‹nombre›-imagenes`, `-2`…, nunca sobrescribe); el renderer rasteriza cada página
  con `renderPageToImageBytes` (escala limitada al máximo de canvas) y la envía con
  `write-image` (`pagina-NN.<ext>`); `end-export` cierra la sesión.
- `images-to-pdf`: íntegro en el main; `embedPng`/`embedJpg`, una página por imagen.
  `pageSize`: Carta o A4 (orientada como la imagen, que se escala y se centra) o el
  tamaño de la propia imagen a 72 ppp, como mucho un A4 (`imagePageLayout`). El diálogo
  recuerda la última elección; por defecto, Carta.

## Módulo `forms`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `forms:list` | `{ id }` | `FormFieldDTO[]` |
| `forms:fill` | `{ id, values: FormFieldValue[], flatten }` | `OpenDocumentDTO` |
| `forms:create` | `{ id, fields: NewFormField[] }` | `OpenDocumentDTO` |

- `create`: crea campos (`text`/`checkbox`/`dropdown`) con `form.createX().addToPage()`;
  coordenadas normalizadas → puntos PDF. `NewFormField = { type, name, page, rect, options }`.
  Un nombre que ya existe se renombra (`nombre_2`…) y los puntos se sustituyen por `_`
  (en AcroForm indican jerarquía); si un campo no se puede crear, error y no se guarda
  nada (antes se omitía en silencio).

- `list`: campos del AcroForm con tipo, valor actual y opciones.
- `fill`: escribe valores por nombre; `flatten: true` deja el formulario no editable.
- Tipos: `text`, `checkbox`, `radio`, `dropdown`, `optionlist`, `button`, `signature`.

## Módulo `ocr`

| Canal | Request | Response (`data`) |
|-------|---------|-------------------|
| `ocr:extract` | `{ lang, images: string[] }` | `{ text }` |
| `ocr:searchable` | `{ id, lang, pages: OcrInputPage[], baseRevision }` | `OpenDocumentDTO` |
| `ocr:save-text` | `{ text }` (abre diálogo guardar .txt) | `{ filePath }` |

- OCR con **tesseract.js en el main** (Node). El renderer rasteriza con
  `renderPageForOcr` la página tal como se ve (CropBox y rotación aplicados).
- `OcrInputPage` = `{ pageNumber, jpegBase64, imgWidthPx, imgHeightPx }`.
- `searchable`: añade a las **páginas originales** una capa de texto invisible: cada
  palabra con `opacity: 0` en su caja, dentro del marco visible de la página (también
  girada o recortada). El contenido original (vectores, enlaces, formularios) no se
  toca. Antes se sustituía el documento entero por imágenes JPEG de 144 ppp.
- El renderer solo envía las páginas que lo necesitan (`pagesNeedingOcr`): las que no
  tienen texto y las que tienen menos de 50 caracteres sobre una imagen (escaneos con
  un sello o un número). Si no hay ninguna, no se llama al main.
- El main valida las páginas (1..n, sin repetir, imagen no vacía) y el idioma.
- `lang`: `'spa' | 'eng'` (otro valor → error; el código acaba en una ruta de archivo). La primera vez se descarga el modelo (internet) a la
  carpeta de datos de la app (`userData/tessdata`); después funciona sin conexión. Sin
  conexión ni modelo, error `IO_ERROR` comprensible (antes la operación no terminaba).
- Las palabras se adaptan a la fuente estándar (ligaduras «ﬁ» → «fi»); lo que no se
  puede escribir se omite.

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
| `redact:apply` | `{ id, pages: RedactedPage[], baseRevision }` | `OpenDocumentDTO` |

- El renderer rasteriza con `renderPageRedacted` cada página afectada, **quemando**
  los recuadros negros sobre la imagen → el contenido bajo el recuadro se elimina.
- El main reconstruye un documento nuevo: páginas redactadas = imagen; resto =
  `copyPages` (intactas). Antes de guardar elimina las páginas originales arrastradas
  por enlaces (`pruneDeadPages`): no queda rastro del contenido censurado.
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
| `separations:render` | `{ id, pageNumber, dpi, mode }` | `{ space, tiffBase64 }` |
| `separations:export` | `{ files: { name, pngBase64 }[] }` (abre diálogo de carpeta) | `{ dir, count }` |
| `separations:export-gray` | `{ id }` (abre diálogo "guardar") | `{ filePath, ink }` |

- `render`: el main escribe el PDF a temp y ejecuta **Ghostscript** con `tiff32nc`
  (CMYK) o `tiff24nc` (RGB) según `mode` (`auto` detecta el espacio). El renderer
  separa los canales (`utif`), como mucho 2 renders a la vez, y guarda las planchas
  en bytes (las de páginas fuera de vista se descartan).
- `export`: escribe en una subcarpeta nueva (`separacion-planchas`, nombres saneados).
- `export-gray`: PDF en una sola tinta negra (pdfwrite); verifica la cobertura con
  `inkcov`. Escribe en un temporal y luego en la ruta elegida (admite «%» en el nombre).
- **Ghostscript** empaquetado con la app (`resources/gs/<plataforma>-<arq>`) o del sistema.

## Ventana y sistema (`app:*`)

Canales sin documento, entre la ventana y el proceso main (`window.api.app`).

| Canal | Tipo | Uso |
|-------|------|-----|
| `app:set-dirty` | envío | El renderer informa de si hay cambios sin guardar (aviso al cerrar). |
| `app:confirm-unsaved` | invoke `{ message, detail, saveLabel }` | Diálogo nativo Guardar / Cancelar / Descartar → `'save' \| 'cancel' \| 'discard'`. |
| `app:close-requested` | evento main → renderer | Se cerró la ventana con cambios: el renderer cierra cada documento preguntando (el activo primero). |
| `app:close-request-ack` / `app:close-request-done` | envío | Recibido / resultado (`true` = cerrar). Si el renderer no confirma en 2 s, aviso nativo de respaldo. Con Cmd+Q, la app sale al terminar. |
| `app:take-pending-open` | invoke | PDFs que el SO pidió abrir antes de montar la UI. |
| `app:open-path` | evento main → renderer | El SO pide abrir un PDF con la app ya abierta. |
| `app:existing-paths` | invoke `string[]` (máx. 50) | Las rutas que siguen existiendo (los «Recientes» ocultan las demás). |
| `app:manual-path` | invoke | Ruta del manual empaquetado o `null`. |
| `app:consume-first-run` | invoke | `true` solo en la primera ejecución. |
| `app:reveal` / `app:beep` | envío | Mostrar un archivo en Finder/Explorador (si existe) / sonido de aviso. |

La versión que muestra «Acerca de» se inyecta al compilar desde `package.json`
(`__APP_VERSION__`).

## Cómo se consume desde la UI

La UI **no** usa `window.api` directamente: pasa por `documentClient`
([`renderer/src/services/document.client.ts`](../src/renderer/src/services/document.client.ts)),
que desempaqueta el `IpcResult` y lanza un `ClientError` legible cuando `ok === false`.
