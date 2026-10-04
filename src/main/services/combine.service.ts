import { join, basename } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import { pruneDeadPages } from './pdf-cleanup'
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
      let bytes: Uint8Array
      try {
        bytes = await this.files.read(path)
      } catch {
        throw new DocumentError('NOT_FOUND', `No se pudo leer: ${basename(path)}`)
      }
      // Un PDF cifrado se descifra antes (si sus permisos lo permiten): copiar sus
      // páginas cifradas producía páginas en blanco.
      const src = await this.documents.loadForCopy(bytes, basename(path))
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach((p) => out.addPage(p))
    }
    // copyPages arrastra las páginas a las que apuntan los enlaces internos.
    pruneDeadPages(out)

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
    const doc = this.documents.getEditableDocument(id)

    let src: PDFDocument
    try {
      src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }
    const total = src.getPageCount()
    if (total <= 1) throw new DocumentError('INVALID_PDF', 'El documento tiene una sola página')

    const parent = await this.files.pickDirectory(window)
    if (!parent) throw new DocumentError('CANCELLED', 'División cancelada por el usuario')

    const baseName = doc.fileName.replace(/\.pdf$/i, '')
    // Subcarpeta nueva («‹nombre›-partes»): antes se escribían junto a lo que hubiera
    // y se sobrescribían partes de otras divisiones sin avisar.
    let dir: string
    try {
      dir = await this.files.createUniqueFolder(parent, `${baseName}-partes`)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo crear la carpeta de destino')
    }
    let count = 0
    const pad = String(Math.ceil(total / chunk)).length

    try {
      for (let start = 0; start < total; start += chunk) {
        const indices = Array.from({ length: Math.min(chunk, total - start) }, (_, k) => start + k)
        const out = await PDFDocument.create()
        const pages = await out.copyPages(src, indices)
        pages.forEach((p) => out.addPage(p))
        // Sin las páginas de otras partes que arrastran los enlaces internos.
        pruneDeadPages(out)
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
