import { PDFDocument, degrees } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import type { DocumentId, OpenDocumentDTO, RotationDelta } from '@shared/ipc-contract'

/**
 * Lógica del módulo "pages": rotar, borrar, reordenar, duplicar, insertar y
 * extraer páginas. Único lugar (junto a DocumentService) que conoce pdf-lib.
 *
 * Patrón: cargar bytes -> manipular con pdf-lib -> guardar -> doc.replaceBytes()
 * -> devolver el DTO actualizado vía DocumentService.describe().
 */
export class PagesService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService
  ) {}

  /** Gira las páginas indicadas un delta en grados (múltiplo de 90). */
  async rotate(
    id: DocumentId,
    pageIndices: number[],
    delta: RotationDelta
  ): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    this.assertIndices(pageIndices, pdf.getPageCount())

    const pages = pdf.getPages()
    for (const idx of pageIndices) {
      const current = pages[idx].getRotation().angle
      pages[idx].setRotation(degrees(normalizeAngle(current + delta)))
    }

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Borra las páginas indicadas. No permite vaciar el documento. */
  async remove(id: DocumentId, pageIndices: number[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    const total = pdf.getPageCount()
    this.assertIndices(pageIndices, total)

    const toDelete = new Set(pageIndices)
    if (toDelete.size >= total) {
      throw new DocumentError('INVALID_PDF', 'No se pueden borrar todas las páginas')
    }
    const keep = range(total).filter((i) => !toDelete.has(i))

    doc.replaceBytes(await this.rebuild(pdf, keep))
    return this.documents.describe(id)
  }

  /** Reordena las páginas según una permutación completa de índices. */
  async reorder(id: DocumentId, order: number[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    this.assertPermutation(order, pdf.getPageCount())

    doc.replaceBytes(await this.rebuild(pdf, order))
    return this.documents.describe(id)
  }

  /** Duplica las páginas indicadas, insertando cada copia tras su original. */
  async duplicate(id: DocumentId, pageIndices: number[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    const total = pdf.getPageCount()
    this.assertIndices(pageIndices, total)

    const selected = new Set(pageIndices)
    const sequence: number[] = []
    for (let i = 0; i < total; i++) {
      sequence.push(i)
      if (selected.has(i)) sequence.push(i)
    }

    doc.replaceBytes(await this.rebuild(pdf, sequence))
    return this.documents.describe(id)
  }

  /** Inserta, en la posición indicada, todas las páginas de otro PDF elegido por el usuario. */
  async insert(
    id: DocumentId,
    atIndex: number,
    window: BrowserWindow | null
  ): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const target = await this.load(doc.bytes)
    const position = clampIndex(atIndex, target.getPageCount())

    const sourcePath = await this.files.pickOpenPath(window)
    if (!sourcePath) throw new DocumentError('CANCELLED', 'Inserción cancelada por el usuario')

    let sourceBytes: Uint8Array
    try {
      sourceBytes = await this.files.read(sourcePath)
    } catch {
      throw new DocumentError('NOT_FOUND', `No se pudo leer: ${sourcePath}`)
    }

    const source = await this.load(sourceBytes)
    const copied = await target.copyPages(source, source.getPageIndices())
    copied.forEach((page, i) => target.insertPage(position + i, page))

    doc.replaceBytes(await target.save())
    return this.documents.describe(id)
  }

  /** Extrae las páginas indicadas a un PDF nuevo guardado en disco (no muta el actual). */
  async extract(
    id: DocumentId,
    pageIndices: number[],
    window: BrowserWindow | null
  ): Promise<{ filePath: string }> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    this.assertIndices(pageIndices, pdf.getPageCount())

    const bytes = await this.rebuild(pdf, [...pageIndices])
    const suggested = doc.fileName.replace(/\.pdf$/i, '') + '-extraido.pdf'
    const target = await this.files.pickSavePath(window, suggested)
    if (!target) throw new DocumentError('CANCELLED', 'Extracción cancelada por el usuario')

    try {
      await this.files.write(target, bytes)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo extraído')
    }
    return { filePath: target }
  }

  // -- helpers --------------------------------------------------------------

  /** Crea un PDF nuevo copiando las páginas de `source` en el orden dado. */
  private async rebuild(source: PDFDocument, indices: number[]): Promise<Uint8Array> {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(source, indices)
    copied.forEach((page) => out.addPage(page))
    copyMetadata(source, out)
    return out.save()
  }

  private async load(bytes: Uint8Array): Promise<PDFDocument> {
    try {
      return await PDFDocument.load(bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }
  }

  private assertIndices(indices: number[], total: number): void {
    if (indices.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No se seleccionó ninguna página')
    }
    for (const i of indices) {
      if (!Number.isInteger(i) || i < 0 || i >= total) {
        throw new DocumentError('INVALID_PDF', `Índice de página fuera de rango: ${i}`)
      }
    }
  }

  private assertPermutation(order: number[], total: number): void {
    const valid =
      order.length === total && new Set(order).size === total && order.every((i) => i >= 0 && i < total)
    if (!valid) {
      throw new DocumentError('INVALID_PDF', 'El nuevo orden no es una permutación válida')
    }
  }
}

/** Copia metadatos básicos al reconstruir el documento (no se pierden al reordenar/borrar). */
function copyMetadata(src: PDFDocument, dst: PDFDocument): void {
  const title = src.getTitle()
  const author = src.getAuthor()
  const subject = src.getSubject()
  const keywords = src.getKeywords()
  const creator = src.getCreator()
  if (title) dst.setTitle(title)
  if (author) dst.setAuthor(author)
  if (subject) dst.setSubject(subject)
  if (keywords) dst.setKeywords(keywords.split(/[,;]\s*/))
  if (creator) dst.setCreator(creator)
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

function clampIndex(index: number, total: number): number {
  return Math.max(0, Math.min(total, index))
}
