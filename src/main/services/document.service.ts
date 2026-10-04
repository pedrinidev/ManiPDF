import { PDFDocument } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { PdfDocument, type Lock } from '../domain/document.model'
import { FileService } from './file.service'
import { canAssemble, canModify, decryptPdf, encryptPdf, readEncryption } from './pdf-crypto'
import {
  detectColorLabel,
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
      | 'DECRYPT_UNSUPPORTED'
      | 'GHOSTSCRIPT_MISSING'
      | 'READ_ONLY'
      | 'CONFLICT',
    message: string
  ) {
    super(message)
    this.name = 'DocumentError'
  }
}

/** Mensaje para el usuario cuando intenta modificar un documento de solo lectura. */
const LOCK_MESSAGES: Record<Lock['reason'], string> = {
  'needs-password': 'El documento está protegido: introduce su contraseña para poder editarlo.',
  restricted:
    'Este PDF no permite modificaciones. Para editarlo, desbloquéalo con la contraseña de propietario.',
  undecryptable: 'No se pudo descifrar este PDF protegido: solo puede verse, no editarse.'
}

/**
 * Lógica de negocio del módulo "document".
 * Mantiene el registro en memoria de los PDF abiertos en la sesión y
 * orquesta FileService (disco) + pdf-lib (parsing/metadata).
 *
 * Es el ÚNICO lugar que conoce pdf-lib en este módulo: si mañana cambiamos
 * de librería, solo se toca aquí.
 *
 * PDFs cifrados: se descifran en memoria para poder editarlos cuando se puede
 * (sin contraseña de apertura y con permiso de modificar, o tras introducir la
 * contraseña) y, al guardar, se vuelven a cifrar con la misma contraseña de
 * apertura y los mismos permisos. Si no se pueden descifrar quedan en solo
 * lectura: editarlos cifrados los corrompía.
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
    await this.prepareEncrypted(doc)
    this.registry.set(doc.id, doc)

    return this.toOpenDTO(doc, pageCount)
  }

  /** Guarda en la ruta actual; si es un documento nuevo, delega en saveAs. */
  async save(id: DocumentId, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const doc = this.require(id)
    if (!doc.filePath) return this.saveAs(id, window)

    const bytes = await this.bytesForDisk(doc)
    try {
      await this.files.write(doc.filePath, bytes)
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

    const bytes = await this.bytesForDisk(doc)
    try {
      await this.files.write(target, bytes)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo en disco')
    }
    doc.markSaved(target)
    return { filePath: target }
  }

  /**
   * Bytes a escribir en disco: si el documento se abrió protegido y se descifró en
   * memoria, se vuelve a cifrar con su contraseña de apertura y sus permisos para
   * que el archivo siga protegido igual; si no, tal cual (un documento que sigue
   * cifrado ya tiene sus bytes originales).
   */
  private async bytesForDisk(doc: PdfDocument): Promise<Uint8Array> {
    if (!doc.protection) return doc.bytes
    return encryptPdf(doc.bytes, doc.protection)
  }

  /**
   * Exporta una COPIA del documento (con sus cambios aplicados) a un PDF nuevo,
   * SIN tocar el estado de la pestaña (no cambia filePath ni marca como guardado).
   * Si el documento estaba protegido, la copia también lo está (antes salía sin
   * cifrar).
   */
  async exportCopy(id: DocumentId, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const doc = this.require(id)
    const suggested = doc.fileName.replace(/\.pdf$/i, '') + '-copia.pdf'
    const target = await this.files.pickSavePath(window, suggested)
    if (!target) throw new DocumentError('CANCELLED', 'Exportación cancelada por el usuario')

    const bytes = await this.bytesForDisk(doc)
    try {
      await this.files.write(target, bytes)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo en disco')
    }
    return { filePath: target }
  }

  /**
   * Restaura los bytes del documento a un estado anterior (deshacer/rehacer).
   * El renderer mantiene los snapshots; aquí se VALIDAN antes de reemplazar: unos
   * bytes inválidos dejaban el documento corrupto y el siguiente Guardar lo
   * escribía en disco.
   */
  async restore(id: DocumentId, data: Uint8Array): Promise<OpenDocumentDTO> {
    const doc = this.getEditableDocument(id)
    const pageCount = await this.validateAndCountPages(data)
    doc.restoreBytes(data)
    return this.toOpenDTO(doc, pageCount)
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
      // Del diccionario /Encrypt real (antes bastaba con que «/Encrypt» apareciera
      // en cualquier parte del archivo, p. ej. en un texto).
      encrypted: doc.protection !== null || pdf.isEncrypted,
      colorSpace: detectColorLabel(doc.bytes),
      pageSizes: groupPageSizes(pdf.getPages().map((p) => p.getSize()))
    }
  }

  /**
   * Desbloquea un documento cifrado con la contraseña dada:
   * - Si pedía contraseña de apertura, es esa contraseña.
   * - Si se abría sin contraseña pero sus permisos no permiten modificarlo, debe
   *   ser la de PROPIETARIO (una contraseña no vacía que lo descifra solo puede
   *   ser esa, porque la de apertura está vacía).
   * El archivo en disco no se toca; al guardar se vuelve a cifrar igual.
   */
  async unlock(id: DocumentId, password: string): Promise<OpenDocumentDTO> {
    const doc = this.require(id)
    const lock = doc.lock
    if (!lock) return this.describe(id) // ya está desbloqueado

    const ownerOnly = lock.reason !== 'needs-password'
    // Para verificar la de propietario solo vale el método sin pérdidas: Ghostscript
    // abriría un PDF sin contraseña de apertura con CUALQUIER contraseña.
    const result = await decryptPdf(doc.bytes, password, { allowGhostscript: !ownerOnly })
    if (result.ok === 'unsupported') {
      throw new DocumentError(
        'DECRYPT_UNSUPPORTED',
        ownerOnly
          ? 'No se pudo comprobar la contraseña de propietario de este PDF.'
          : 'No se pudo descifrar este PDF protegido.'
      )
    }
    if (result.ok === 'wrong-password') {
      throw new DocumentError('WRONG_PASSWORD', 'Contraseña incorrecta')
    }
    const pageCount = await this.validateAndCountPages(result.bytes)
    doc.setDecryptedBytes(result.bytes, {
      userPassword: ownerOnly ? '' : password,
      ownerPassword: ownerOnly ? password : null,
      permissions: lock.permissions
    })
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
   * Documento para operaciones que lo modifican (o que crean otro PDF a partir de
   * él con pdf-lib). Lanza READ_ONLY si sigue cifrado en memoria y CONFLICT si se
   * indica `baseRevision` y el documento ha cambiado desde entonces (la operación
   * se preparó sobre una versión anterior: p. ej. censurar tras reordenar páginas
   * habría puesto la imagen de una página en el lugar de otra).
   */
  getEditableDocument(id: DocumentId, baseRevision?: number): PdfDocument {
    const doc = this.require(id)
    if (doc.lock) throw new DocumentError('READ_ONLY', LOCK_MESSAGES[doc.lock.reason])
    if (baseRevision !== undefined && baseRevision !== doc.revision) {
      throw new DocumentError(
        'CONFLICT',
        'El documento cambió mientras se preparaba la operación. Vuelve a intentarlo.'
      )
    }
    return doc
  }

  /**
   * Carga OTRO PDF para copiar sus páginas (insertar, combinar). Si está cifrado
   * se descifra antes, siempre que se abra sin contraseña y sus permisos permitan
   * ensamblar: copiar páginas cifradas producía páginas en blanco.
   */
  async loadForCopy(bytes: Uint8Array, name: string): Promise<PDFDocument> {
    let plain = bytes
    const info = await readEncryption(bytes).catch(() => ({ encrypted: false, permissions: null }))
    if (info.encrypted) {
      if (!canAssemble(info.permissions)) {
        throw new DocumentError('READ_ONLY', `«${name}» está protegido: sus permisos no permiten copiar sus páginas.`)
      }
      const result = await decryptPdf(bytes, '')
      if (result.ok !== true) {
        throw new DocumentError(
          'READ_ONLY',
          `«${name}» está protegido con contraseña: ábrelo en ManiPDF, desbloquéalo y guárdalo antes de usarlo aquí.`
        )
      }
      plain = result.bytes
    }
    try {
      return await this.load(plain)
    } catch {
      throw new DocumentError('INVALID_PDF', `No se pudo leer un PDF válido: ${name}`)
    }
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

  /**
   * PDF cifrado recién abierto: se descifra en memoria si se abre sin contraseña y
   * sus permisos permiten modificarlo. Si no, queda en solo lectura:
   * - pide contraseña de apertura → el visor la solicita y se desbloquea con ella;
   * - no permite modificaciones → se puede desbloquear con la de propietario;
   * - no se ha podido descifrar → solo lectura.
   */
  private async prepareEncrypted(doc: PdfDocument): Promise<void> {
    const info = await readEncryption(doc.bytes).catch(() => null)
    if (!info?.encrypted) return
    const permissions = info.permissions ?? -4

    const result = await decryptPdf(doc.bytes, '')
    if (result.ok === 'wrong-password') {
      doc.markLocked({ reason: 'needs-password', permissions })
    } else if (result.ok !== true) {
      doc.markLocked({ reason: 'undecryptable', permissions })
    } else if (!canModify(permissions)) {
      doc.markLocked({ reason: 'restricted', permissions })
    } else {
      doc.setDecryptedBytes(result.bytes, { userPassword: '', ownerPassword: null, permissions })
    }
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
      isDirty: doc.isDirty,
      readOnly: doc.lock?.reason ?? null,
      revision: doc.revision
    }
  }
}
