import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { FileService } from './services/file.service'
import { DocumentService } from './services/document.service'
import { PagesService } from './services/pages.service'
import { AnnotationsService } from './services/annotations.service'
import { SecurityService } from './services/security.service'
import { OptimizeService } from './services/optimize.service'
import { ConvertService } from './services/convert.service'
import { FormsService } from './services/forms.service'
import { OcrService } from './services/ocr.service'
import { StampService } from './services/stamp.service'
import { RedactService } from './services/redact.service'
import { CombineService } from './services/combine.service'
import { CompareService } from './services/compare.service'
import { SeparationsService } from './services/separations.service'
import { PrintService } from './services/print.service'
import { registerDocumentIpc } from './ipc/document.ipc'
import { registerPagesIpc } from './ipc/pages.ipc'
import { registerAnnotationsIpc } from './ipc/annotations.ipc'
import { registerSecurityIpc } from './ipc/security.ipc'
import { registerOptimizeIpc } from './ipc/optimize.ipc'
import { registerConvertIpc } from './ipc/convert.ipc'
import { registerFormsIpc } from './ipc/forms.ipc'
import { registerOcrIpc } from './ipc/ocr.ipc'
import { registerStampIpc } from './ipc/stamp.ipc'
import { registerRedactIpc } from './ipc/redact.ipc'
import { registerCombineIpc } from './ipc/combine.ipc'
import { registerCompareIpc } from './ipc/compare.ipc'
import { registerSeparationsIpc } from './ipc/separations.ipc'
import { registerPrintIpc } from './ipc/print.ipc'

/** Estado de "cambios sin guardar" que reporta el renderer (para el aviso al cerrar). */
let documentDirty = false

/**
 * Composition root: aquí se instancian los services y se cablean los módulos IPC.
 * Es el único sitio que conoce todas las piezas; el resto depende de abstracciones.
 */
function registerModules(): void {
  ipcMain.on('app:set-dirty', (_e, dirty: boolean) => {
    documentDirty = dirty
  })

  // Revela un archivo en el explorador del SO. Se valida que exista para no
  // pasar rutas arbitrarias al shell.
  ipcMain.on('app:reveal', (_e, filePath: unknown) => {
    if (typeof filePath === 'string' && existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    }
  })

  // Diálogo nativo de "cambios sin guardar": devuelve 'save' | 'cancel' | 'discard'.
  ipcMain.handle(
    'app:confirm-unsaved',
    async (event, opts: { message: string; detail: string; saveLabel: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const boxOptions = {
        type: 'warning' as const,
        buttons: [opts.saveLabel, 'Cancelar', 'Descartar'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: opts.message,
        detail: opts.detail
      }
      const result = win
        ? await dialog.showMessageBox(win, boxOptions)
        : await dialog.showMessageBox(boxOptions)
      return (['save', 'cancel', 'discard'] as const)[result.response] ?? 'cancel'
    }
  )

  const fileService = new FileService()
  const documentService = new DocumentService(fileService)
  const pagesService = new PagesService(documentService, fileService)
  const annotationsService = new AnnotationsService(documentService, fileService)
  const securityService = new SecurityService(documentService, fileService)
  const optimizeService = new OptimizeService(documentService)
  const convertService = new ConvertService(fileService)
  const formsService = new FormsService(documentService)
  const ocrService = new OcrService(documentService, fileService)
  const stampService = new StampService(documentService)
  const redactService = new RedactService(documentService)
  const combineService = new CombineService(documentService, fileService)
  const compareService = new CompareService(fileService)
  const separationsService = new SeparationsService(documentService, fileService)
  const printService = new PrintService(documentService)

  registerDocumentIpc(documentService)
  registerPagesIpc(pagesService)
  registerAnnotationsIpc(annotationsService)
  registerSecurityIpc(securityService)
  registerOptimizeIpc(optimizeService)
  registerConvertIpc(convertService)
  registerFormsIpc(formsService)
  registerOcrIpc(ocrService)
  registerStampIpc(stampService)
  registerRedactIpc(redactService)
  registerCombineIpc(combineService)
  registerCompareIpc(compareService)
  registerSeparationsIpc(separationsService)
  registerPrintIpc(printService)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e22',
    title: 'ManiPDF',
    // En macOS, integramos la barra de menú en la barra de título (semáforo
    // sobre el contenido, con margen) en vez de una barra nativa separada.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, // necesario para que el preload use módulos de Node
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // Aviso si se intenta cerrar con cambios sin guardar.
  window.on('close', (event) => {
    if (!documentDirty) return
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['Cancelar', 'Cerrar sin guardar'],
      defaultId: 0,
      cancelId: 0,
      title: 'Cambios sin guardar',
      message: 'El documento tiene cambios sin guardar.',
      detail: '¿Cerrar de todas formas? Se perderán los cambios no guardados.'
    })
    if (choice === 0) event.preventDefault()
    else documentDirty = false
  })

  // Los enlaces externos se abren en el navegador del sistema, no en la app.
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  // En desarrollo (macOS) el dock muestra el icono genérico de Electron; forzamos
  // el de la app para verlo. En producción lo aporta el bundle .app/.icns de
  // electron-builder (build/ no viaja dentro del asar → existsSync será falso).
  if (process.platform === 'darwin' && app.dock) {
    const devIcon = join(__dirname, '../../build/icon.png')
    if (existsSync(devIcon)) app.dock.setIcon(devIcon)
  }

  registerModules()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
