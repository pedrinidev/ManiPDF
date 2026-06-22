import { Buffer } from 'node:buffer'
import { join, extname, basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentError } from './document.service'
import { FileService } from './file.service'
import type { ImageFormat } from '@shared/ipc-contract'

/**
 * Lógica del módulo "convert": PDF -> imágenes e imágenes -> PDF.
 *
 * El render de PDF a imagen lo hace el renderer (tiene el canvas); aquí solo se
 * escriben los archivos. La conversión de imágenes a PDF es íntegra en el main.
 */
export class ConvertService {
  constructor(private readonly files: FileService) {}

  /** Escribe en una carpeta las imágenes ya rasterizadas (una por página). */
  async exportImages(
    format: ImageFormat,
    images: string[],
    window: BrowserWindow | null
  ): Promise<{ dir: string; count: number }> {
    if (images.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No hay páginas que exportar')
    }
    const dir = await this.files.pickDirectory(window)
    if (!dir) throw new DocumentError('CANCELLED', 'Exportación cancelada por el usuario')

    const ext = format === 'jpg' ? 'jpg' : 'png'
    const pad = String(images.length).length

    try {
      for (let i = 0; i < images.length; i++) {
        const name = `pagina-${String(i + 1).padStart(pad, '0')}.${ext}`
        await this.files.write(join(dir, name), Buffer.from(images[i], 'base64'))
      }
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudieron escribir las imágenes')
    }

    return { dir, count: images.length }
  }

  /** Ensambla un PDF a partir de imágenes elegidas por el usuario (1 página por imagen). */
  async imagesToPdf(window: BrowserWindow | null): Promise<{ filePath: string }> {
    const paths = await this.files.pickOpenImages(window)
    if (paths.length === 0) throw new DocumentError('CANCELLED', 'Conversión cancelada por el usuario')

    const pdf = await PDFDocument.create()
    for (const path of paths) {
      const bytes = await this.files.read(path)
      const ext = extname(path).toLowerCase()
      const image =
        ext === '.jpg' || ext === '.jpeg'
          ? await pdf.embedJpg(bytes)
          : await pdf.embedPng(bytes).catch(() => {
              throw new DocumentError('INVALID_PDF', `Imagen no soportada: ${basename(path)}`)
            })
      const page = pdf.addPage([image.width, image.height])
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
    }

    const target = await this.files.pickSavePath(window, 'imagenes.pdf')
    if (!target) throw new DocumentError('CANCELLED', 'Guardado cancelado por el usuario')

    try {
      await this.files.write(target, await pdf.save())
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el PDF')
    }
    return { filePath: target }
  }
}
