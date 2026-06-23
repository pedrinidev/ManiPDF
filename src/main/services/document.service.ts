import { Buffer } from 'node:buffer'
import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { PdfDocument } from '../domain/document.model'
import { FileService } from './file.service'
import type {
  DocumentId,
  DocumentMetadataDTO,
  OpenDocumentDTO,
  PageSizeGroup
} from '@shared/ipc-contract'

/** Error de dominio con código tipado; los handlers IPC lo traducen a IpcError. */
export class DocumentError extends Error {
  constructor(
    readonly code: 'CANCELLED' | 'NOT_FOUND' | 'INVALID_PDF' | 'IO_ERROR' | 'NO_DOCUMENT',
    message: string
  ) {
    super(message)
    this.name = 'DocumentError'
  }
}

/**
 * Lógica de negocio del módulo "document".
 * Mantiene el registro en memoria de los PDF abiertos en la sesión y
 * orquesta FileService (disco) + pdf-lib (parsing/metadata).
 *
 * Es el ÚNICO lugar que conoce pdf-lib en este módulo: si mañana cambiamos
 * de librería, solo se toca aquí.
 */
export class DocumentService {
  private readonly registry = new Map<DocumentId, PdfDocument>()

  constructor(private readonly files: FileService) {}

  /** Abre un PDF vía diálogo nativo. */
  async open(window: BrowserWindow | null): Promise<OpenDocumentDTO> {
    const filePath = await this.files.pickOpenPath(window)
    if (!filePath) throw new DocumentError('CANCELLED', 'Apertura cancelada por el usuario')
    return this.openPath(filePath)
  }

  /** Abre un PDF desde una ruta concreta (drag&drop, "abrir reciente", CLI...). */
  async openPath(filePath: string): Promise<OpenDocumentDTO> {
    let bytes: Uint8Array
    try {
      bytes = await this.files.read(filePath)
    } catch {
      throw new DocumentError('NOT_FOUND', `No se pudo leer el archivo: ${filePath}`)
    }

    const pageCount = await this.validateAndCountPages(bytes)
    const doc = PdfDocument.fromBytes(bytes, filePath)
    this.registry.set(doc.id, doc)

    return this.toOpenDTO(doc, pageCount)
  }

  /** Guarda en la ruta actual; si es un documento nuevo, delega en saveAs. */
  async save(id: DocumentId, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const doc = this.require(id)
    if (!doc.filePath) return this.saveAs(id, window)

    try {
      await this.files.write(doc.filePath, doc.bytes)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo en disco')
    }
    doc.markSaved(doc.filePath)
    return { filePath: doc.filePath }
  }

  /** Guarda con un nombre/ubicación nuevos vía diálogo nativo. */
  async saveAs(id: DocumentId, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const doc = this.require(id)
    const target = await this.files.pickSavePath(window, doc.fileName)
    if (!target) throw new DocumentError('CANCELLED', 'Guardado cancelado por el usuario')

    try {
      await this.files.write(target, doc.bytes)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo en disco')
    }
    doc.markSaved(target)
    return { filePath: target }
  }

  /**
   * Exporta una COPIA del documento (con sus cambios aplicados) a un PDF nuevo,
   * SIN tocar el estado de la pestaña (no cambia filePath ni marca como guardado).
   */
  async exportCopy(id: DocumentId, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const doc = this.require(id)
    const suggested = doc.fileName.replace(/\.pdf$/i, '') + '-copia.pdf'
    const target = await this.files.pickSavePath(window, suggested)
    if (!target) throw new DocumentError('CANCELLED', 'Exportación cancelada por el usuario')

    try {
      await this.files.write(target, doc.bytes)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo en disco')
    }
    return { filePath: target }
  }

  /**
   * Restaura los bytes del documento a un estado anterior (deshacer/rehacer).
   * El renderer mantiene los snapshots; aquí solo se reemplazan los bytes.
   */
  async restore(id: DocumentId, dataBase64: string): Promise<OpenDocumentDTO> {
    const doc = this.require(id)
    doc.replaceBytes(Buffer.from(dataBase64, 'base64'))
    return this.describe(id)
  }

  /** Lee los metadatos del PDF (título, autor, fechas, tamaños, color, etc.). */
  async metadata(id: DocumentId): Promise<DocumentMetadataDTO> {
    const doc = this.require(id)
    const pdf = await this.load(doc.bytes)
    return {
      title: pdf.getTitle() ?? null,
      author: pdf.getAuthor() ?? null,
      subject: pdf.getSubject() ?? null,
      keywords: pdf.getKeywords() ?? null,
      creator: pdf.getCreator() ?? null,
      producer: pdf.getProducer() ?? null,
      creationDate: pdf.getCreationDate()?.toISOString() ?? null,
      modificationDate: pdf.getModificationDate()?.toISOString() ?? null,
      pageCount: pdf.getPageCount(),
      fileSize: doc.bytes.byteLength,
      pdfVersion: detectPdfVersion(doc.bytes),
      encrypted: detectEncrypted(doc.bytes),
      colorSpace: detectColorLabel(doc.bytes),
      pageSizes: groupPageSizes(pdf.getPages().map((p) => p.getSize()))
    }
  }

  /** Cierra un documento y lo retira del registro. */
  close(id: DocumentId): { id: DocumentId } {
    this.require(id)
    this.registry.delete(id)
    return { id }
  }

  // -- helpers internos -----------------------------------------------------

  /** Devuelve el documento o lanza si no existe en la sesión. */
  private require(id: DocumentId): PdfDocument {
    const doc = this.registry.get(id)
    if (!doc) throw new DocumentError('NO_DOCUMENT', `Documento no encontrado: ${id}`)
    return doc
  }

  /** Acceso de solo lectura para otros módulos (pages, annotations...). */
  getDocument(id: DocumentId): PdfDocument {
    return this.require(id)
  }

  /**
   * Reconstruye el DTO de un documento desde su estado actual en memoria.
   * Lo usan los módulos que mutan el PDF (pages...) para devolver a la UI
   * los bytes y el pageCount actualizados.
   */
  async describe(id: DocumentId): Promise<OpenDocumentDTO> {
    const doc = this.require(id)
    const pdf = await this.load(doc.bytes)
    return this.toOpenDTO(doc, pdf.getPageCount())
  }

  private async validateAndCountPages(bytes: Uint8Array): Promise<number> {
    try {
      const pdf = await this.load(bytes)
      return pdf.getPageCount()
    } catch {
      throw new DocumentError('INVALID_PDF', 'El archivo no es un PDF válido o está dañado')
    }
  }

  private async load(bytes: Uint8Array): Promise<PDFDocument> {
    // ignoreEncryption: permite abrir PDFs con cifrado para mostrar metadata.
    return PDFDocument.load(bytes, { ignoreEncryption: true })
  }

  private toOpenDTO(doc: PdfDocument, pageCount: number): OpenDocumentDTO {
    return {
      id: doc.id,
      filePath: doc.filePath,
      fileName: doc.fileName,
      pageCount,
      dataBase64: Buffer.from(doc.bytes).toString('base64'),
      isDirty: doc.isDirty
    }
  }
}

/** Lee la versión del encabezado "%PDF-1.x" en los primeros bytes. */
function detectPdfVersion(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 16)).toString('latin1')
  const m = head.match(/%PDF-(\d+\.\d+)/)
  return m ? m[1] : null
}

/** Heurística: el documento está cifrado si su trailer referencia /Encrypt. */
function detectEncrypted(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).toString('latin1').includes('/Encrypt')
}

/**
 * Etiqueta heurística del espacio de color, contando los operadores de color del
 * contenido. Es aproximado (no abre cada flujo), suficiente para informar.
 */
function detectColorLabel(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('latin1')
  const cmyk = (text.match(/DeviceCMYK/g) || []).length + (text.match(/\/N\s+4\b/g) || []).length
  const rgb =
    (text.match(/DeviceRGB|CalRGB/g) || []).length + (text.match(/\/N\s+3\b/g) || []).length
  const gray = (text.match(/DeviceGray|CalGray/g) || []).length + (text.match(/\/N\s+1\b/g) || []).length
  if (cmyk > 0 && rgb > 0) return 'Color (RGB + CMYK)'
  if (cmyk > 0) return 'Color (CMYK)'
  if (rgb > 0) return 'Color (RGB)'
  if (gray > 0) return 'Escala de grises'
  return 'No determinado'
}

/** Nombres de tamaños de papel conocidos, en puntos PDF (orientación vertical). */
const KNOWN_SIZES: { name: string; w: number; h: number }[] = [
  { name: 'Carta', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'Tabloide', w: 792, h: 1224 },
  { name: 'A3', w: 841.89, h: 1190.55 },
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A5', w: 419.53, h: 595.28 }
]

/** Agrupa los tamaños de página iguales y los etiqueta (cm + nombre si se reconoce). */
function groupPageSizes(sizes: { width: number; height: number }[]): PageSizeGroup[] {
  const groups = new Map<string, PageSizeGroup>()
  for (const { width, height } of sizes) {
    const w = Math.round(width * 10) / 10
    const h = Math.round(height * 10) / 10
    const key = `${w}x${h}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    groups.set(key, { widthPt: w, heightPt: h, count: 1, label: sizeLabel(w, h) })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/** "21.6 × 27.9 cm · Carta" (el nombre solo si coincide con un tamaño conocido). */
function sizeLabel(w: number, h: number): string {
  const cm = (pt: number): string => (pt / 72 * 2.54).toFixed(1)
  const tol = 4 // puntos de tolerancia (≈1.4 mm)
  const match = KNOWN_SIZES.find(
    (s) =>
      (Math.abs(w - s.w) < tol && Math.abs(h - s.h) < tol) ||
      (Math.abs(w - s.h) < tol && Math.abs(h - s.w) < tol)
  )
  const base = `${cm(w)} × ${cm(h)} cm`
  return match ? `${base} · ${match.name}` : base
}
