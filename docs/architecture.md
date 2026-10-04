# Arquitectura — ManiPDF

Editor de PDF de escritorio profesional. Objetivo: una arquitectura modular y
mantenible, y una herramienta de PDF completa de uso personal y profesional.

## Stack

| Capa | Tecnología | Rol |
|------|-----------|-----|
| Shell de escritorio | **Electron** | Ventana nativa + acceso a sistema de archivos |
| Build / dev | **electron-vite** + **Vite** | HMR, bundling de main/preload/renderer |
| UI | **React 19** + **TypeScript** | Interfaz por componentes |
| Render de PDF | **pdf.js** (pdfjs-dist) | Rasteriza páginas a canvas |
| Manipulación de PDF | **pdf-lib** | Leer/escribir/editar el PDF |

## Procesos y límites

Electron tiene dos procesos. La separación es la columna vertebral del diseño:

```
┌──────────────────────────────────────────────────────────┐
│ RENDERER (Chromium) — src/renderer                         │
│   ui/        componentes presentacionales (MenuBar, …)     │
│   views/     vistas compuestas (Viewer, PagesPanel, …)     │
│   state/     estado controlado (useReducer + context)      │
│   services/  *.client.ts          → habla SOLO con window.api│
│              pdf-renderer.ts      → aísla pdf.js            │
│              navigate.ts / *-math → navegación (DOM / pura) │
└───────────────────────────┬──────────────────────────────┘
                            │ window.api  (contextBridge)
                            │ canales tipados del contrato
┌───────────────────────────┴──────────────────────────────┐
│ PRELOAD — src/preload                                      │
│   Expone una API mínima y tipada. NO expone ipcRenderer    │
│   crudo ni Node al renderer (contextIsolation: true).      │
└───────────────────────────┬──────────────────────────────┘
                            │ ipcRenderer.invoke / ipcMain.handle
┌───────────────────────────┴──────────────────────────────┐
│ MAIN (Node) — src/main                                     │
│   index.ts    composition root (instancia y cablea todo)   │
│   menu.ts     menú nativo (propio en macOS, ninguno en Win/Linux)│
│   ipc/        handlers (controllers, SIN lógica de negocio)│
│   services/   lógica: DocumentService, FileService…        │
│               pdf-crypto.ts  cifrar/descifrar (AES, sin pérdidas)│
│               pdf-cleanup.ts páginas muertas y huérfanos  │
│               temp.ts        temporales «manipdf-*» (y limpieza al arrancar)│
│   domain/     modelos puros: PdfDocument                   │
└──────────────────────────────────────────────────────────┘

  src/shared/ipc-contract.ts  ← contrato compartido por los 3 lados
```

## Reglas arquitectónicas (no negociables)

1. **La UI nunca toca pdf-lib ni fs.** Pasa por `document.client.ts` → `window.api` → IPC → service.
2. **Los handlers IPC no tienen lógica.** Extraen args, llaman al service, envuelven el resultado.
3. **El dominio (`PdfDocument`) no conoce Electron ni librerías.** Es testeable en aislamiento.
4. **Solo `FileService` toca `fs` y `dialog`.** El resto de la lógica queda libre del entorno.
5. **Un único `IpcResult<T>` para todo.** Nunca se lanzan excepciones a través del puente; los errores viajan como datos con código tipado.
6. **El contrato (`shared/`) es la fuente de verdad.** Cambiar una firma rompe la compilación en ambos lados a propósito.

## Flujo de una operación (ejemplo: "Abrir PDF")

1. Usuario pulsa *Abrir* → `Toolbar` llama `openDialog()` del store.
2. Store → `documentClient.open()` → `window.api.document.open()`.
3. Preload → `ipcRenderer.invoke('document:open')`.
4. Handler `document.ipc.ts` → `DocumentService.open()`.
5. Service → `FileService.pickOpenPath()` (diálogo nativo) → `read()` → valida con pdf-lib.
6. Vuelve un `OpenDocumentDTO` (incluye los bytes del PDF) hasta el store.
7. `Viewer` reacciona: `pdf-renderer.ts` decodifica y rasteriza cada página en un canvas.

## Visor y navegación (renderer)

- `PdfProvider` (`state/pdf.context.tsx`) carga el documento con pdf.js y, **antes de
  publicarlo**, obtiene el tamaño de todas las páginas (`getPageSizes`). El visor
  reserva así el hueco exacto de cada página desde el primer pintado.
- `Viewer` solo pinta las páginas a menos de 1500 px de la zona visible
  (IntersectionObserver); el resto queda como hueco del tamaño exacto. La memoria de
  canvas queda acotada sea cual sea el zoom.
- `renderPage` pinta en un lienzo de trabajo y lo vuelca al visible al terminar; cada
  render es **cancelable** (zoom nuevo, recarga, desmontaje). pdf.js no admite dos
  renders a la vez sobre el mismo canvas.
- pdf.js desactiva el suavizado al ampliar imágenes sin `/Interpolate`; ManiPDF lo deja
  siempre activo (`canvas-smoothing.ts` + una `CanvasFactory` propia para los lienzos
  auxiliares de pdf.js).
- `NavigationProvider` (`state/navigation.context.tsx`) calcula la página actual a
  partir del scroll (búsqueda binaria sobre las páginas), salta a páginas desplazando
  **solo** el área del documento (`scrollIntoView` movía también la interfaz) y, al
  cambiar el zoom, conserva el punto que se estaba viendo.
- El zoom de Chromium no se usa: en macOS el menú propio no lo incluye y Cmd/Ctrl +/−/0
  y el pellizco del trackpad controlan el zoom del visor.
- Búsqueda (`state/search.context.tsx`): el texto de cada página se prepara una vez por
  instancia de pdf.js (`text-search.ts`: texto normalizado + origen de cada carácter) y
  cada coincidencia se convierte en cajas con la matriz del texto y el viewport (vale
  para páginas giradas y recortadas). Al recalcular tras una edición no salta a la
  primera coincidencia.
- La capa de texto de pdf.js se maqueta sin girar y se gira por CSS según
  `data-main-rotation` (reglas copiadas de su visor en `styles.css`).
- `PdfProvider` publica, junto con el pdf.js, la `revision` del documento del que lo
  cargó. Las operaciones que rasterizan con él (censurar, PDF buscable, comprimir
  rasterizando) la envían como `baseRevision`; si mientras tanto el documento cambió,
  el main responde `CONFLICT` en vez de aplicar un resultado obsoleto.

## Cómo viaja el PDF

El render (pdf.js) vive en el renderer; el archivo se lee en el main. El DTO lleva los
bytes como `Uint8Array` (clonado estructurado de Electron, sin base64: evita codificar y
~33 % de memoria extra en cada edición). Las imágenes que el renderer rasteriza para el
main (censurar, comprimir, OCR) aún viajan en base64; la exportación a imágenes ya envía
bytes, página a página. Si en el futuro los PDFs grandes pesan, se migrará a streaming
por `MessagePort` o a un protocolo propio; está aislado en `pdf-renderer.ts` y en el DTO,
así que el cambio será local.

## Decisiones aún abiertas

- «Recientes»: se guardan en `localStorage` del renderer (máx. 8); al mostrar la
  pantalla inicial se ocultan los que ya no existen (`app:existing-paths`). Si hiciera
  falta compartirlos entre ventanas o sobrevivir a borrar los datos del navegador,
  pasarían a un archivo en `userData`.
- Edición que modifique bytes (rotar, borrar páginas) actualizará `PdfDocument.bytes`
  vía `replaceBytes()` y re-emitirá el DTO al renderer.

Ver [modules.md](modules.md) para el estado de cada módulo y [api.md](api.md) para el contrato IPC.
