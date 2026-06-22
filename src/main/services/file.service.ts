import { readFile, writeFile } from 'node:fs/promises'
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

  /** Lee un archivo de disco como bytes. */
  async read(filePath: string): Promise<Uint8Array> {
    const buffer = await readFile(filePath)
    return new Uint8Array(buffer)
  }

  /** Escribe bytes a disco. */
  async write(filePath: string, bytes: Uint8Array): Promise<void> {
    await writeFile(filePath, bytes)
  }
}
