import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannel } from '@shared/ipc-contract'
import type { AppApi } from '@shared/ipc-contract'

/**
 * API que el renderer ve como `window.api`.
 * Es la ÚNICA superficie por la que la UI puede hablar con el sistema.
 * No exponemos ipcRenderer crudo: solo métodos concretos y tipados.
 * El tipo AppApi vive en shared: garantiza que preload y renderer no se desincronicen.
 */
const api: AppApi = {
  document: {
    open: () => ipcRenderer.invoke(IpcChannel.DocumentOpen),
    openPath: (filePath) => ipcRenderer.invoke(IpcChannel.DocumentOpenPath, { filePath }),
    save: (id) => ipcRenderer.invoke(IpcChannel.DocumentSave, { id }),
    saveAs: (id) => ipcRenderer.invoke(IpcChannel.DocumentSaveAs, { id }),
    metadata: (id) => ipcRenderer.invoke(IpcChannel.DocumentMetadata, { id }),
    unlock: (id, password) => ipcRenderer.invoke(IpcChannel.DocumentUnlock, { id, password }),
    close: (id) => ipcRenderer.invoke(IpcChannel.DocumentClose, { id }),
    print: (id) => ipcRenderer.invoke(IpcChannel.DocumentPrint, { id }),
    exportCopy: (id) => ipcRenderer.invoke(IpcChannel.DocumentExportCopy, { id }),
    restore: (id, data) => ipcRenderer.invoke(IpcChannel.DocumentRestore, { id, data })
  },
  pages: {
    rotate: (id, pageIndices, delta) =>
      ipcRenderer.invoke(IpcChannel.PagesRotate, { id, pageIndices, delta }),
    remove: (id, pageIndices) =>
      ipcRenderer.invoke(IpcChannel.PagesDelete, { id, pageIndices }),
    reorder: (id, order) => ipcRenderer.invoke(IpcChannel.PagesReorder, { id, order }),
    duplicate: (id, pageIndices) =>
      ipcRenderer.invoke(IpcChannel.PagesDuplicate, { id, pageIndices }),
    insert: (id, atIndex) => ipcRenderer.invoke(IpcChannel.PagesInsert, { id, atIndex }),
    extract: (id, pageIndices) =>
      ipcRenderer.invoke(IpcChannel.PagesExtract, { id, pageIndices })
  },
  annotations: {
    burn: (id, annotations) =>
      ipcRenderer.invoke(IpcChannel.AnnotationsBurn, { id, annotations }),
    pickImage: () => ipcRenderer.invoke(IpcChannel.AnnotationsPickImage)
  },
  security: {
    protect: (id, options) => ipcRenderer.invoke(IpcChannel.SecurityProtect, { id, options })
  },
  optimize: {
    lossless: (id) => ipcRenderer.invoke(IpcChannel.OptimizeLossless, { id }),
    rebuildFromImages: (id, pages) =>
      ipcRenderer.invoke(IpcChannel.OptimizeRebuildFromImages, { id, pages })
  },
  convert: {
    exportImages: (format, images) =>
      ipcRenderer.invoke(IpcChannel.ConvertExportImages, { format, images }),
    imagesToPdf: () => ipcRenderer.invoke(IpcChannel.ConvertImagesToPdf)
  },
  forms: {
    list: (id) => ipcRenderer.invoke(IpcChannel.FormsList, { id }),
    fill: (id, values, flatten) =>
      ipcRenderer.invoke(IpcChannel.FormsFill, { id, values, flatten }),
    create: (id, fields) => ipcRenderer.invoke(IpcChannel.FormsCreate, { id, fields })
  },
  ocr: {
    extract: (lang, images) => ipcRenderer.invoke(IpcChannel.OcrExtract, { lang, images }),
    searchable: (id, lang, pages) =>
      ipcRenderer.invoke(IpcChannel.OcrSearchable, { id, lang, pages }),
    saveText: (text) => ipcRenderer.invoke(IpcChannel.OcrSaveText, { text })
  },
  stamp: {
    apply: (id, config) => ipcRenderer.invoke(IpcChannel.StampApply, { id, config })
  },
  redact: {
    apply: (id, pages) => ipcRenderer.invoke(IpcChannel.RedactApply, { id, pages })
  },
  combine: {
    merge: () => ipcRenderer.invoke(IpcChannel.CombineMerge),
    split: (id, everyN) => ipcRenderer.invoke(IpcChannel.CombineSplit, { id, everyN })
  },
  compare: {
    pick: () => ipcRenderer.invoke(IpcChannel.ComparePick)
  },
  separations: {
    render: (id, pageNumber, dpi, mode) =>
      ipcRenderer.invoke(IpcChannel.SeparationsRender, { id, pageNumber, dpi, mode }),
    exportFiles: (files) => ipcRenderer.invoke(IpcChannel.SeparationsExport, { files }),
    exportGray: (id) => ipcRenderer.invoke(IpcChannel.SeparationsExportGray, { id })
  },
  system: {
    getPathForFile: (file) => webUtils.getPathForFile(file as never),
    platform: process.platform
  },
  app: {
    setDirty: (dirty) => ipcRenderer.send('app:set-dirty', dirty),
    reveal: (filePath) => ipcRenderer.send('app:reveal', filePath),
    beep: () => ipcRenderer.send('app:beep'),
    manualPath: () => ipcRenderer.invoke('app:manual-path'),
    firstRun: () => ipcRenderer.invoke('app:consume-first-run'),
    confirmUnsaved: (opts) => ipcRenderer.invoke('app:confirm-unsaved', opts)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Fallback para entornos sin aislamiento de contexto (no recomendado en prod).
  // @ts-ignore -- window extendido manualmente
  window.api = api
}
