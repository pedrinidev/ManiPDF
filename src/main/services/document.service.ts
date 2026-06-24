import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { PdfDocument } from '../domain/document.model'
import { FileService } from './file.service'
import { decryptPdf, encryptPdf } from './pdf-crypto'
import {
  detectColorLabel,
  detectEncrypted,
  detectPdfVersion,
  groupPageSizes
} from './pdf-metadata'
import type { DocumentId, DocumentMetadataDTO, OpenDocumentDTO } from '@shared/ipc-contract'

/** Error de dominio con código tipado; los handlers IPC lo traducen a IpcError. */
export class DocumentError extends Error {
  constructor(
    readonly code:
      | 'CANCELLED'
      | 'NOT_FOUND'
      | 'INVALID_PDF'
      | 'IO_ERROR'
      | 'NO_DOCUMENT'
      | 'WRONG_PASSWORD'
      | 'DECRYPT_UNSUPPORTED',
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
      await this.files.write(doc.filePath, await this.bytesForDisk(doc))
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
      await this.files.write(target, await this.bytesForDisk(doc))
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo en disco')
    }
    doc.markSaved(target)
    return { filePath: target }
  }

  /**
   * Bytes a escribir en disco: si el documento se abrió protegido, se vuelve a
   * cifrar con su contraseña para que el archivo siga protegido; si no, tal cual.
   */
  private async bytesForDisk(doc: PdfDocument): Promise<Uint8Array> {
    if (!doc.encryptionPassword) return doc.bytes
    return encryptPdf(doc.bytes, doc.encryptionPassword)
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
  async restore(id: DocumentId, data: Uint8Array): Promise<OpenDocumentDTO> {
    const doc = this.require(id)
    doc.replaceBytes(data)
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

  /**
   * Descifra en memoria un PDF protegido con la contraseña dada, para poder
   * verlo y editarlo. El archivo en disco no se toca; al guardar se vuelve a
   * cifrar con la misma contraseña.
   */
  async unlock(id: DocumentId, password: string): Promise<OpenDocumentDTO> {
    const doc = this.require(id)
    const result = await decryptPdf(doc.bytes, password)
    if (result.ok === 'unsupported') {
      throw new DocumentError(
        'DECRYPT_UNSUPPORTED',
        'No se pudo descifrar: falta Ghostscript para abrir PDFs protegidos.'
      )
    }
    if (result.ok === 'wrong-password') {
      throw new DocumentError('WRONG_PASSWORD', 'Contraseña incorrecta')
    }
    const pageCount = await this.validateAndCountPages(result.bytes)
    doc.setDecryptedBytes(result.bytes, password)
    return this.toOpenDTO(doc, pageCount)
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
      data: doc.bytes,
      isDirty: doc.isDirty
    }
  }
}

