import { join } from 'node:path'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
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

/** Ventana principal (para reenviarle archivos que el SO pide abrir). */
let mainWindow: BrowserWindow | null = null
/** PDFs pendientes de abrir (p. ej. recibidos antes de que el renderer esté listo). */
const pendingOpen: string[] = []
/** true cuando el renderer ya montó y escucha aperturas. */
let rendererReady = false

/** Devuelve la ruta de un .pdf existente entre los argumentos, o null. */
function pdfFromArgv(argv: string[]): string | null {
  return argv.find((a) => /\.pdf$/i.test(a) && existsSync(a)) ?? null
}

/** Abre un PDF en el renderer; si aún no está listo, lo deja en cola. */
function openInRenderer(path: string): void {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:open-path', path)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    pendingOpen.push(path)
  }
}

/**
 * Composition root: aquí se instancian los services y se cablean los módulos IPC.
 * Es el único sitio que conoce todas las piezas; el resto depende de abstracciones.
 */
function registerModules(): void {
  ipcMain.on('app:set-dirty', (_e, dirty: boolean) => {
    documentDirty = dirty
  })

  // Sonido del sistema (p. ej. al pulsar fuera de un diálogo modal).
  ipcMain.on('app:beep', () => {
    shell.beep()
  })

  // Ruta del manual de usuario empaquetado (build/manual.pdf en dev, resources en
  // producción). Devuelve null si no existe.
  ipcMain.handle('app:manual-path', () => {
    const candidates = [
      join(process.resourcesPath ?? '', 'manual.pdf'),
      join(__dirname, '../../build/manual.pdf')
    ]
    return candidates.find((p) => p && existsSync(p)) ?? null
  })

  // El renderer avisa de que ya está listo y recoge los PDFs en cola (los que el
  // SO pidió abrir antes de montar la interfaz). A partir de aquí, las aperturas
  // se envían por evento.
  ipcMain.handle('app:take-pending-open', () => {
    rendererReady = true
    const paths = [...pendingOpen]
    pendingOpen.length = 0
    return paths
  })

  // Primera ejecución tras instalar: devuelve true SOLO la primera vez (luego deja
  // una marca en userData). Sirve para mostrar el manual al estrenar la app.
  ipcMain.handle('app:consume-first-run', () => {
    const marker = join(app.getPath('userData'), '.manipdf-first-run-done')
    if (existsSync(marker)) return false
    try {
      writeFileSync(marker, new Date().toISOString())
    } catch {
      return false // si no podemos marcar, no insistimos en cada arranque
    }
    return true
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

// macOS: abrir un PDF desde Finder o el dock (puede llegar ANTES de estar listos).
app.on('open-file', (event, path) => {
  event.preventDefault()
  openInRenderer(path)
})

// Instancia única: si ya hay una abierta, la segunda pasa su archivo y se cierra.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const p = pdfFromArgv(argv)
    if (p) openInRenderer(p)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    // En desarrollo (macOS) el dock muestra el icono genérico de Electron; forzamos
    // el de la app para verlo. En producción lo aporta el bundle .app/.icns de
    // electron-builder (build/ no viaja dentro del asar → existsSync será falso).
    if (process.platform === 'darwin' && app.dock) {
      const devIcon = join(__dirname, '../../build/icon.png')
      if (existsSync(devIcon)) app.dock.setIcon(devIcon)
    }

    registerModules()
    mainWindow = createWindow()
    maybeRemindUpdate()

    // Windows/Linux: el PDF con el que se lanzó la app llega como argumento.
    const argvPath = pdfFromArgv(process.argv)
    if (argvPath) openInRenderer(argvPath)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })
}

/** Días de uso recomendados antes de sugerir actualizar/reinstalar. */
const USAGE_LIMIT_DAYS = 365

/** Fecha de la primera apertura (reutiliza la marca de primera ejecución). */
function firstOpenDate(): Date | null {
  const marker = join(app.getPath('userData'), '.manipdf-first-run-done')
  if (!existsSync(marker)) return null
  try {
    const d = new Date(readFileSync(marker, 'utf8').trim())
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

/**
 * Si la app lleva instalada más de un año, muestra un recordatorio (no bloquea el
 * uso) para actualizar o reinstalar. Es un aviso del lado cliente.
 */
function maybeRemindUpdate(): void {
  const installed = firstOpenDate()
  if (!installed) return
  const days = (Date.now() - installed.getTime()) / 86_400_000
  if (days < USAGE_LIMIT_DAYS) return
  void dialog.showMessageBox({
    type: 'info',
    title: 'ManiPDF',
    message: 'Llevas más de un año usando ManiPDF',
    detail:
      'Te recomendamos actualizar o reinstalar la aplicación para obtener mejoras y correcciones.',
    buttons: ['Entendido']
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
