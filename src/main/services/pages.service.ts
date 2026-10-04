import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFPageLeaf,
  PDFRef,
  degrees
} from 'pdf-lib'
import { basename } from 'node:path'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import { annotationRefs, pruneDeadPages, pruneFormFields } from './pdf-cleanup'
import type { DocumentId, OpenDocumentDTO, RotationDelta } from '@shared/ipc-contract'

/**
 * Lógica del módulo "pages": rotar, borrar, reordenar, duplicar, insertar y
 * extraer páginas. Único lugar (junto a DocumentService) que conoce pdf-lib.
 *
 * Patrón: cargar bytes -> manipular con pdf-lib -> guardar -> doc.replaceBytes()
 * -> devolver el DTO actualizado vía DocumentService.describe().
 *
 * Las operaciones trabajan SOBRE EL PROPIO DOCUMENTO (no copian las páginas a uno
 * nuevo): así se conserva todo lo que vive en el catálogo —formulario, marcadores,
 * destinos, etiquetas, estructura, adjuntos—, que antes se perdía al borrar,
 * reordenar o duplicar. Lo que queda sin uso se limpia antes de guardar.
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
    const doc = this.documents.getEditableDocument(id)
    const pdf = await this.load(doc.bytes)
    this.assertIndices(pageIndices, pdf.getPageCount())

    const pages = pdf.getPages()
    for (const idx of new Set(pageIndices)) {
      const current = pages[idx].getRotation().angle
      pages[idx].setRotation(degrees(normalizeAngle(current + delta)))
    }

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Borra las páginas indicadas. No permite vaciar el documento. */
  async remove(id: DocumentId, pageIndices: number[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id)
    const pdf = await this.load(doc.bytes)
    const total = pdf.getPageCount()
    this.assertIndices(pageIndices, total)

    const toDelete = new Set(pageIndices)
    if (toDelete.size >= total) {
      throw new DocumentError('INVALID_PDF', 'No se pueden borrar todas las páginas')
    }
    removePagesInPlace(pdf, toDelete)

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Reordena las páginas según una permutación completa de índices. */
  async reorder(id: DocumentId, order: number[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id)
    const pdf = await this.load(doc.bytes)
    this.assertPermutation(order, pdf.getPageCount())

    // Cada página se lleva consigo lo que heredaba de su nodo padre (recursos,
    // tamaño, giro): al recolocarla puede acabar bajo otro nodo del árbol.
    pinInheritedAttributes(pdf)
    const pages = pdf.getPages()
    for (let i = pages.length - 1; i >= 0; i--) pdf.removePage(i)
    for (const idx of order) pdf.addPage(pages[idx])

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Duplica las páginas indicadas, insertando cada copia tras su original. */
  async duplicate(id: DocumentId, pageIndices: number[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id)
    const pdf = await this.load(doc.bytes)
    this.assertIndices(pageIndices, pdf.getPageCount())

    pinInheritedAttributes(pdf)
    const selected = [...new Set(pageIndices)].sort((a, b) => a - b)
    const originals = pdf.getPages()
    // De la última a la primera: insertar no desplaza las posiciones pendientes.
    for (let k = selected.length - 1; k >= 0; k--) {
      const index = selected[k]
      pdf.insertPage(index + 1, clonePage(pdf, originals[index]))
    }

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Inserta, en la posición indicada, todas las páginas de otro PDF elegido por el usuario. */
  async insert(
    id: DocumentId,
    atIndex: number,
    window: BrowserWindow | null
  ): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id)
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

    // Un PDF de origen cifrado se descifra antes (si sus permisos lo permiten):
    // copiar sus páginas cifradas producía páginas en blanco.
    const source = await this.documents.loadForCopy(sourceBytes, basename(sourcePath))
    const copied = await target.copyPages(source, source.getPageIndices())
    copied.forEach((page, i) => target.insertPage(position + i, page))
    // copyPages arrastra las páginas del origen a las que apuntan sus enlaces.
    pruneDeadPages(target)

    doc.replaceBytes(await target.save())
    return this.documents.describe(id)
  }

  /** Extrae las páginas indicadas a un PDF nuevo guardado en disco (no muta el actual). */
  async extract(
    id: DocumentId,
    pageIndices: number[],
    window: BrowserWindow | null
  ): Promise<{ filePath: string }> {
    const doc = this.documents.getEditableDocument(id)
    // Copia propia en memoria: se quitan las demás páginas en el sitio, así el PDF
    // extraído conserva formulario, marcadores y metadatos de las suyas.
    const pdf = await this.load(doc.bytes)
    const total = pdf.getPageCount()
    this.assertIndices(pageIndices, total)
    const keep = new Set(pageIndices)
    removePagesInPlace(pdf, new Set(range(total).filter((i) => !keep.has(i))))
    const bytes = await pdf.save()

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

/**
 * Quita páginas del documento en el sitio: también sus widgets del formulario y,
 * con `pruneDeadPages`, su contenido del archivo (antes seguía dentro).
 */
function removePagesInPlace(pdf: PDFDocument, indices: Set<number>): void {
  if (indices.size === 0) return
  const pages = pdf.getPages()
  const removedAnnots = annotationRefs([...indices].map((i) => pages[i]))
  for (const i of [...indices].sort((a, b) => b - a)) pdf.removePage(i)
  pruneFormFields(pdf, removedAnnots)
  pruneDeadPages(pdf)
}

/**
 * Copia en cada página los atributos que hereda de sus nodos padre (recursos,
 * tamaño, recorte, giro). Necesario antes de recolocar páginas en el árbol: bajo
 * otro padre podrían quedarse sin recursos (en blanco) o con otro tamaño.
 */
function pinInheritedAttributes(pdf: PDFDocument): void {
  for (const page of pdf.getPages()) {
    for (const name of PDFPageLeaf.InheritableEntries) {
      const key = PDFName.of(name)
      if (page.node.has(key)) continue
      const value = page.node.getInheritableAttribute(key)
      if (value) page.node.set(key, value)
    }
  }
}

/**
 * Copia de una página dentro del mismo documento que COMPARTE su contenido y sus
 * recursos: duplicar una página con una foto no duplica la foto en el archivo.
 * Sus anotaciones se clonan (cada anotación pertenece a una sola página) y los
 * widgets pasan a ser otro widget del MISMO campo (mismo valor en ambas páginas,
 * como en Acrobat). Los widgets que son a la vez el propio campo no se clonan.
 */
function clonePage(pdf: PDFDocument, original: PDFPage): PDFPage {
  const { context } = pdf
  const leaf = original.node.clone()
  leaf.delete(PDFName.of('Parent')) // insertPage le asigna el nuevo padre
  const ref = context.register(leaf)

  const annots = original.node.Annots()
  if (annots) {
    const copies: PDFRef[] = []
    for (const item of annots.asArray()) {
      const annot = item instanceof PDFRef ? context.lookup(item) : item
      if (!(annot instanceof PDFDict)) continue
      const subtype = annot.get(PDFName.of('Subtype'))
      if (subtype === PDFName.of('Popup')) continue // va unida a su anotación original
      const isWidget = subtype === PDFName.of('Widget')
      const field = annot.lookupMaybe(PDFName.of('Parent'), PDFDict)
      if (isWidget && !field) continue
      const copy = annot.clone()
      copy.set(PDFName.of('P'), ref)
      copy.delete(PDFName.of('Popup'))
      const copyRef = context.register(copy)
      copies.push(copyRef)
      if (isWidget) field?.lookupMaybe(PDFName.of('Kids'), PDFArray)?.push(copyRef)
    }
    leaf.set(PDFName.of('Annots'), context.obj(copies))
  }
  return PDFPage.of(leaf, ref, pdf)
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
