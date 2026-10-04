import { randomUUID } from 'node:crypto'
import { join, extname, basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentError } from './document.service'
import { FileService } from './file.service'
import type { ImageFormat, ImagePageSize } from '@shared/ipc-contract'

/** Lados corto y largo de cada tamaño de papel, en puntos PDF. */
const PAPER: Record<'letter' | 'a4', { short: number; long: number }> = {
  letter: { short: 612, long: 792 }, // 8,5 × 11 pulgadas
  a4: { short: 595.28, long: 841.89 } // 210 × 297 mm
}

/**
 * Página y caja de la imagen según el tamaño elegido. En Carta y A4 la página se
 * orienta como la imagen, que se escala para caber (conservando su proporción) y
 * se centra. «image»: la página mide lo que la imagen a 72 ppp, reducida si hace
 * falta para no superar un A4 (antes de limitarlo, una foto de 3000 px daba una
 * página de 106 cm).
 */
export function imagePageLayout(
  imageWidth: number,
  imageHeight: number,
  pageSize: ImagePageSize
): { pageWidth: number; pageHeight: number; x: number; y: number; width: number; height: number } {
  const landscape = imageWidth > imageHeight
  const paper = pageSize === 'letter' ? PAPER.letter : PAPER.a4
  const maxW = landscape ? paper.long : paper.short
  const maxH = landscape ? paper.short : paper.long
  if (pageSize === 'image') {
    const scale = Math.min(1, maxW / imageWidth, maxH / imageHeight)
    const width = imageWidth * scale
    const height = imageHeight * scale
    return { pageWidth: width, pageHeight: height, x: 0, y: 0, width, height }
  }
  const scale = Math.min(maxW / imageWidth, maxH / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return { pageWidth: maxW, pageHeight: maxH, x: (maxW - width) / 2, y: (maxH - height) / 2, width, height }
}

/**
 * Lógica del módulo "convert": PDF -> imágenes e imágenes -> PDF.
 *
 * El render de PDF a imagen lo hace el renderer (tiene el canvas); aquí solo se
 * escriben los archivos. La conversión de imágenes a PDF es íntegra en el main.
 */
export class ConvertService {
  constructor(private readonly files: FileService) {}

  /** Exportaciones a imágenes en curso (ver beginExport). */
  private readonly exports = new Map<
    string,
    { dir: string; ext: string; pad: number; total: number; count: number }
  >()

  /**
   * Empieza a exportar un documento a imágenes: pide la carpeta y crea dentro una
   * subcarpeta NUEVA («‹nombre›-imagenes»), así nunca se sobrescriben archivos (antes
   * «pagina-01.png» pisaba lo que hubiera). El renderer envía después cada página
   * según la rasteriza: antes se rasterizaban todas en memoria y se enviaban juntas.
   */
  async beginExport(
    baseName: string,
    format: ImageFormat,
    total: number,
    window: BrowserWindow | null
  ): Promise<{ exportId: string; dir: string }> {
    if (!Number.isInteger(total) || total < 1) {
      throw new DocumentError('INVALID_PDF', 'No hay páginas que exportar')
    }
    const parent = await this.files.pickDirectory(window)
    if (!parent) throw new DocumentError('CANCELLED', 'Exportación cancelada por el usuario')
    let dir: string
    try {
      dir = await this.files.createUniqueFolder(parent, `${baseName}-imagenes`)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo crear la carpeta de destino')
    }
    const exportId = randomUUID()
    const ext = format === 'jpg' ? 'jpg' : 'png'
    this.exports.set(exportId, { dir, ext, pad: String(total).length, total, count: 0 })
    return { exportId, dir }
  }

  /** Escribe la imagen de una página de una exportación en curso. */
  async writeImage(exportId: string, pageNumber: number, data: Uint8Array): Promise<void> {
    const job = this.exports.get(exportId)
    if (!job) throw new DocumentError('NO_DOCUMENT', 'La exportación ya no está en curso')
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > job.total) {
      throw new DocumentError('INVALID_PDF', `Página fuera de rango: ${pageNumber}`)
    }
    if (data.length === 0) {
      throw new DocumentError('IO_ERROR', `La imagen de la página ${pageNumber} salió vacía`)
    }
    const name = `pagina-${String(pageNumber).padStart(job.pad, '0')}.${job.ext}`
    try {
      await this.files.write(join(job.dir, name), data)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudieron escribir las imágenes')
    }
    job.count++
  }

  /** Termina una exportación (también si se interrumpió) y devuelve el resumen. */
  endExport(exportId: string): { dir: string; count: number } {
    const job = this.exports.get(exportId)
    if (!job) throw new DocumentError('NO_DOCUMENT', 'La exportación ya no está en curso')
    this.exports.delete(exportId)
    return { dir: job.dir, count: job.count }
  }

  /** Ensambla un PDF a partir de imágenes elegidas por el usuario (1 página por imagen). */
  async imagesToPdf(pageSize: ImagePageSize, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const size: ImagePageSize = pageSize === 'a4' || pageSize === 'image' ? pageSize : 'letter'
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
      const layout = imagePageLayout(image.width, image.height, size)
      const page = pdf.addPage([layout.pageWidth, layout.pageHeight])
      page.drawImage(image, { x: layout.x, y: layout.y, width: layout.width, height: layout.height })
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
