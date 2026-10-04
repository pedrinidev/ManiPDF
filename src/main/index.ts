import { join } from 'node:path'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { app, BrowserWindow, shell, ipcMain, dialog, Menu, nativeTheme } from 'electron'
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
import { removeStaleTempDirs } from './services/temp'
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
import { buildMenuTemplate } from './menu'

/** Estado de "cambios sin guardar" que reporta el renderer (para el aviso al cerrar). */
let documentDirty = false

/** Ventana principal (para reenviarle archivos que el SO pide abrir). */
let mainWindow: BrowserWindow | null = null
/** PDFs pendientes de abrir (p. ej. recibidos antes de que el renderer esté listo). */
const pendingOpen: string[] = []
/** true cuando el renderer ya montó y escucha aperturas. */
let rendererReady = false

/**
 * Cierre de la ventana con cambios: el renderer pregunta documento a documento
 * (Guardar / Cancelar / Descartar). `acked`: el renderer recibió la petición;
 * `quitAfter`: el cierre venía de salir de la app (Cmd+Q).
 */
let closeRequest: { acked: boolean; quitAfter: boolean } | null = null
/** El cierre ya está resuelto: el siguiente 'close' no vuelve a preguntar. */
let closeApproved = false
/** Se pidió salir de la app (Cmd+Q / menú): tras resolver el cierre, se sale. */
let quitRequested = false
/** Si el renderer no confirma la petición en este tiempo (colgado), aviso nativo. */
const CLOSE_ACK_TIMEOUT_MS = 2000

/** Cierra la ventana sin volver a preguntar (y sale de la app si se pidió). */
function finishClose(window: BrowserWindow, quitAfter: boolean): void {
  closeApproved = true
  documentDirty = false
  if (!window.isDestroyed()) window.close()
  if (quitAfter) app.quit()
}

/** Aviso nativo de respaldo (sin «Guardar»: guardar lo hace el renderer). */
function nativeCloseDialog(window: BrowserWindow, quitAfter: boolean): void {
  if (window.isDestroyed()) return
  const choice = dialog.showMessageBoxSync(window, {
    type: 'warning',
    buttons: ['Cancelar', 'Cerrar sin guardar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Cambios sin guardar',
    message: 'El documento tiene cambios sin guardar.',
    detail: '¿Cerrar de todas formas? Se perderán los cambios no guardados.'
  })
  if (choice !== 0) finishClose(window, quitAfter)
}

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
    // macOS: la app sigue abierta sin ventanas. Abrir un PDF desde Finder no hacía
    // nada hasta pulsar el Dock; ahora se abre una ventana (que recoge la cola).
    if (app.isReady() && (!mainWindow || mainWindow.isDestroyed())) mainWindow = createWindow()
  }
}

/** Solo se abren fuera de la app enlaces web y de correo (no file:, smb:, etc.). */
function isSafeExternalUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
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

  // Respuesta del renderer a 'app:close-requested' (ver el 'close' de la ventana).
  ipcMain.on('app:close-request-ack', () => {
    if (closeRequest) closeRequest.acked = true
  })
  ipcMain.on('app:close-request-done', (event, approved: unknown) => {
    const request = closeRequest
    closeRequest = null
    const window = BrowserWindow.fromWebContents(event.sender)
    if (request && window && approved === true) finishClose(window, request.quitAfter)
  })

  // Qué rutas de la lista siguen existiendo (la lista de recientes las muestra solo
  // si existen). Entrada validada: hasta 50 rutas de texto.
  ipcMain.handle('app:existing-paths', (_e, paths: unknown) => {
    if (!Array.isArray(paths)) return []
    return paths
      .slice(0, 50)
      .filter((p): p is string => typeof p === 'string' && p.length > 0 && existsSync(p))
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
  // Los modelos de idioma del OCR se guardan en la carpeta de datos de la app.
  const ocrService = new OcrService(documentService, fileService, {
    cacheDir: join(app.getPath('userData'), 'tessdata')
  })
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
      // El preload solo usa módulos permitidos en el sandbox (contextBridge,
      // ipcRenderer, webUtils): el renderer, que procesa PDFs no confiables, queda
      // aislado del sistema.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // La interfaz no usa el zoom de Chromium (el visor tiene el suyo). Chromium lo
  // guarda entre sesiones y en versiones anteriores Cmd +/− lo activaba: se anula
  // al cargar para que nadie se quede con la interfaz ampliada y borrosa.
  window.webContents.on('did-finish-load', () => window.webContents.setZoomLevel(0))

  // Cerrar con cambios sin guardar: el renderer pregunta por cada documento con el
  // mismo diálogo que al cerrar una pestaña, que SÍ ofrece «Guardar» (el aviso
  // nativo solo permitía cancelar o perder los cambios).
  closeApproved = false
  window.on('close', (event) => {
    const quitAfter = quitRequested
    quitRequested = false
    if (!documentDirty || closeApproved) return
    event.preventDefault()
    if (closeRequest) return // ya se está preguntando
    if (!rendererReady || window.webContents.isCrashed()) {
      nativeCloseDialog(window, quitAfter)
      return
    }
    const request = { acked: false, quitAfter }
    closeRequest = request
    window.webContents.send('app:close-requested')
    setTimeout(() => {
      if (closeRequest === request && !request.acked) {
        closeRequest = null
        nativeCloseDialog(window, quitAfter)
      }
    }, CLOSE_ACK_TIMEOUT_MS)
  })

  // Los enlaces externos se abren en el navegador del sistema, no en la app (solo
  // http/https/mailto: un PDF malicioso no puede lanzar file: u otros protocolos).
  window.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // La ventana nunca navega fuera de la interfaz (un enlace o un archivo soltado no
  // debe sustituirla por otra página con acceso a window.api).
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
      rendererReady = false
    }
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

    // Forzamos tema oscuro: en Windows oscurece la barra de título nativa (que con
    // el tema claro del sistema se veía blanca y desentonaba) y también los diálogos
    // nativos, para que combinen con la interfaz oscura de la app.
    nativeTheme.themeSource = 'dark'

    // Menú nativo: ninguno en Windows/Linux (duplicaría el nuestro dentro de la
    // ventana) y uno propio en macOS, sin Recargar ni el zoom de Chromium (ver menu.ts).
    const menuTemplate = buildMenuTemplate(process.platform, app.isPackaged, app.name)
    Menu.setApplicationMenu(menuTemplate ? Menu.buildFromTemplate(menuTemplate) : null)

    registerModules()
    mainWindow = createWindow()
    maybeRemindUpdate()
    // Temporales (a veces con el PDF descifrado) que dejó una ejecución cerrada de golpe.
    void removeStaleTempDirs().catch(() => {})

    // Windows/Linux: el PDF con el que se lanzó la app llega como argumento.
    const argvPath = pdfFromArgv(process.argv)
    if (argvPath) openInRenderer(argvPath)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })
}

/** Días de uso de una versión antes de sugerir actualizar/reinstalar. */
const USAGE_LIMIT_DAYS = 365
/** Como mucho un recordatorio cada tantos días (antes salía en cada arranque). */
const REMIND_EVERY_DAYS = 30

/** Desde cuándo se usa la versión instalada y cuándo se avisó por última vez. */
interface UpdateReminderState {
  version: string
  since: string
  lastShown?: string
}

function daysSince(iso: string | undefined): number {
  const time = iso ? new Date(iso).getTime() : Number.NaN
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : (Date.now() - time) / 86_400_000
}

/**
 * Si la versión instalada lleva más de un año en uso, recuerda (sin bloquear)
 * actualizar o reinstalar. La cuenta empieza con cada versión: antes contaba
 * desde la primera instalación y, tras actualizar, seguía pidiendo actualizar.
 */
function maybeRemindUpdate(): void {
  const file = join(app.getPath('userData'), '.manipdf-update-reminder.json')
  const save = (state: UpdateReminderState): void => {
    try {
      writeFileSync(file, JSON.stringify(state))
    } catch {
      /* sin poder recordarlo, como mucho se repetirá el aviso */
    }
  }
  let state: UpdateReminderState | null = null
  try {
    state = JSON.parse(readFileSync(file, 'utf8')) as UpdateReminderState
  } catch {
    /* primera vez */
  }
  const version = app.getVersion()
  if (!state || state.version !== version) {
    save({ version, since: new Date().toISOString() })
    return
  }
  if (daysSince(state.since) < USAGE_LIMIT_DAYS || daysSince(state.lastShown) < REMIND_EVERY_DAYS) return
  save({ ...state, lastShown: new Date().toISOString() })
  void dialog.showMessageBox({
    type: 'info',
    title: 'ManiPDF',
    message: 'Llevas más de un año usando esta versión de ManiPDF',
    detail:
      'Te recomendamos actualizar o reinstalar la aplicación para obtener mejoras y correcciones.',
    buttons: ['Entendido']
  })
}

app.on('before-quit', () => {
  quitRequested = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
