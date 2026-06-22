import { join, basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import type { DocumentId } from '@shared/ipc-contract'

/**
 * Lógica del módulo "combine": unir varios PDF en uno y dividir el actual.
 */
export class CombineService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService
  ) {}

  /** Une varios PDF elegidos por el usuario en un único archivo nuevo. */
  async merge(window: BrowserWindow | null): Promise<{ filePath: string; pageCount: number }> {
    const paths = await this.files.pickOpenPaths(window)
    if (paths.length < 2) {
      throw new DocumentError('CANCELLED', 'Elige al menos dos PDF para combinar')
    }

    const out = await PDFDocument.create()
    for (const path of paths) {
      let src: PDFDocument
      try {
        src = await PDFDocument.load(await this.files.read(path), { ignoreEncryption: true })
      } catch {
        throw new DocumentError('INVALID_PDF', `No se pudo leer un PDF válido: ${basename(path)}`)
      }
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach((p) => out.addPage(p))
    }

    const target = await this.files.pickSavePath(window, 'combinado.pdf')
    if (!target) throw new DocumentError('CANCELLED', 'Guardado cancelado por el usuario')

    try {
      await this.files.write(target, await out.save())
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el PDF combinado')
    }
    return { filePath: target, pageCount: out.getPageCount() }
  }

  /** Divide el documento actual en archivos de `everyN` páginas, en una carpeta. */
  async split(
    id: DocumentId,
    everyN: number,
    window: BrowserWindow | null
  ): Promise<{ dir: string; count: number }> {
    const chunk = Math.max(1, Math.floor(everyN))
    const doc = this.documents.getDocument(id)

    let src: PDFDocument
    try {
      src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }
    const total = src.getPageCount()
    if (total <= 1) throw new DocumentError('INVALID_PDF', 'El documento tiene una sola página')

    const dir = await this.files.pickDirectory(window)
    if (!dir) throw new DocumentError('CANCELLED', 'División cancelada por el usuario')

    const baseName = doc.fileName.replace(/\.pdf$/i, '')
    let count = 0
    const pad = String(Math.ceil(total / chunk)).length

    try {
      for (let start = 0; start < total; start += chunk) {
        const indices = Array.from({ length: Math.min(chunk, total - start) }, (_, k) => start + k)
        const out = await PDFDocument.create()
        const pages = await out.copyPages(src, indices)
        pages.forEach((p) => out.addPage(p))
        count++
        const name = `${baseName}-parte-${String(count).padStart(pad, '0')}.pdf`
        await this.files.write(join(dir, name), await out.save())
      }
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudieron escribir los archivos divididos')
    }

    return { dir, count }
  }
}
