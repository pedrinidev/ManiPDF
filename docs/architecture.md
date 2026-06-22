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
│   ui/        componentes presentacionales (Toolbar)        │
│   views/     vistas compuestas (Viewer)                    │
│   state/     estado controlado (useReducer + context)      │
│   services/  document.client.ts  → habla SOLO con window.api│
│              pdf-renderer.ts      → aísla pdf.js            │
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
│   ipc/        handlers (controllers, SIN lógica de negocio)│
│   services/   lógica: DocumentService, FileService         │
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
6. Vuelve un `OpenDocumentDTO` (incluye el PDF en base64) hasta el store.
7. `Viewer` reacciona: `pdf-renderer.ts` decodifica y rasteriza cada página en un canvas.

## Por qué el PDF viaja en base64

El render (pdf.js) vive en el renderer; el archivo se lee en el main. Para el MVP
enviamos los bytes en base64 dentro del DTO. Si en el futuro los PDFs grandes pesan,
se migrará a streaming por `MessagePort` o a servir el archivo por un protocolo
`file://` custom. Está aislado en `pdf-renderer.ts` y en el DTO, así que el cambio
será local.

## Decisiones aún abiertas

- Persistencia de "documentos recientes" (¿electron-store?) — pendiente.
- Edición que modifique bytes (rotar, borrar páginas) actualizará `PdfDocument.bytes`
  vía `replaceBytes()` y re-emitirá el DTO al renderer.

Ver [modules.md](modules.md) para el estado de cada módulo y [api.md](api.md) para el contrato IPC.
