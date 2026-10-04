import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { dialog, BrowserWindow } from 'electron'

const PDF_FILTER = { name: 'PDF', extensions: ['pdf'] }
const IMAGE_FILTER = { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg'] }

/**
 * Encapsula TODO el acceso a disco y a diálogos del sistema operativo.
 * Ningún otro service habla con `fs` ni con `dialog` directamente:
 * así el resto de la lógica queda aislada del entorno Electron.
 */
export class FileService {
  /** Abre el diálogo nativo "Abrir" y devuelve la ruta elegida, o null si se cancela. */
  async pickOpenPath(window: BrowserWindow | null): Promise<string | null> {
    const result = window
      ? await dialog.showOpenDialog(window, {
          title: 'Abrir PDF',
          properties: ['openFile'],
          filters: [PDF_FILTER]
        })
      : await dialog.showOpenDialog({
          title: 'Abrir PDF',
          properties: ['openFile'],
          filters: [PDF_FILTER]
        })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  }

  /** Abre el diálogo nativo "Guardar como" y devuelve la ruta, o null si se cancela. */
  async pickSavePath(
    window: BrowserWindow | null,
    defaultName: string
  ): Promise<string | null> {
    const options = {
      title: 'Guardar PDF como',
      defaultPath: defaultName,
      filters: [PDF_FILTER]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) return null
    return result.filePath
  }

  /** Abre el diálogo nativo para elegir varios PDF. */
  async pickOpenPaths(window: BrowserWindow | null): Promise<string[]> {
    const options = {
      title: 'Elegir PDFs',
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [PDF_FILTER]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return result.filePaths
  }

  /** Abre el diálogo nativo para elegir una carpeta de destino. */
  async pickDirectory(window: BrowserWindow | null): Promise<string | null> {
    const options = { title: 'Elegir carpeta de destino', properties: ['openDirectory' as const] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  }

  /** Abre el diálogo nativo para elegir una o varias imágenes. */
  async pickOpenImages(window: BrowserWindow | null): Promise<string[]> {
    const options = {
      title: 'Elegir imágenes',
      properties: ['openFile' as const, 'multiSelections' as const],
      filters: [IMAGE_FILTER]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return result.filePaths
  }

  /** Diálogo "Guardar como" para un archivo de texto (.txt). */
  async pickSaveTextPath(
    window: BrowserWindow | null,
    defaultName: string
  ): Promise<string | null> {
    const options = {
      title: 'Guardar texto como',
      defaultPath: defaultName,
      filters: [{ name: 'Texto', extensions: ['txt'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  }

  /**
   * Crea una carpeta NUEVA dentro de `parent` («nombre», «nombre-2», «nombre-3»…)
   * para dejar en ella varios archivos sin sobrescribir nada de lo que ya había.
   */
  async createUniqueFolder(parent: string, name: string): Promise<string> {
    const base = safeFileName(name)
    for (let n = 1; n < 1000; n++) {
      const dir = join(parent, n === 1 ? base : `${base}-${n}`)
      try {
        await mkdir(dir)
        return dir
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      }
    }
    throw new Error('No se pudo crear una carpeta nueva')
  }

  /** Lee un archivo de disco como bytes. */
  async read(filePath: string): Promise<Uint8Array> {
    const buffer = await readFile(filePath)
    return new Uint8Array(buffer)
  }

  /**
   * Escribe bytes a disco de forma ATÓMICA: primero en un temporal de la misma
   * carpeta y después se renombra sobre el destino. Si algo falla a mitad (disco
   * lleno, cierre inesperado), el archivo anterior queda intacto; antes se
   * truncaba primero y podía perderse el original.
   */
  async write(filePath: string, bytes: Uint8Array): Promise<void> {
    // Si la ruta es un enlace simbólico, se escribe en el archivo real (no se
    // sustituye el enlace por un archivo normal).
    const target = await realpath(filePath).catch(() => filePath)
    const temp = join(dirname(target), `.${basename(target)}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      await writeFile(temp, bytes)
      // Conserva los permisos del archivo que se sustituye.
      const mode = await stat(target).then((s) => s.mode).catch(() => null)
      if (mode !== null) await chmod(temp, mode).catch(() => {})
      await rename(temp, target)
    } catch (err) {
      await rm(temp, { force: true }).catch(() => {})
      // Carpeta sin permiso para crear archivos o destino bloqueado al renombrar
      // (Windows): se escribe directamente, como antes.
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
        await writeFile(target, bytes)
        return
      }
      throw err
    }
  }
}

/** Nombre válido como archivo/carpeta en los tres sistemas (sin / \ : * ? " < > |). */
export function safeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
  return clean.replace(/^\.+/, '') || 'documento'
}
