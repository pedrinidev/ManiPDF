import { PDFDocument } from '@cantoo/pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import type { DocumentId, ProtectOptions } from '@shared/ipc-contract'

/**
 * Lógica del módulo "security": cifrado del PDF con contraseña y permisos.
 *
 * pdf-lib NO sabe cifrar al guardar, por eso este módulo usa @cantoo/pdf-lib
 * (fork pura-JS que añade `encrypt()`). Es el único lugar que conoce esa lib.
 *
 * Estrategia: exporta una COPIA cifrada a disco; el documento abierto en sesión
 * no se toca (sigue viéndose sin contraseña en el visor).
 */
export class SecurityService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService
  ) {}

  async protect(
    id: DocumentId,
    options: ProtectOptions,
    window: BrowserWindow | null
  ): Promise<{ filePath: string }> {
    const userPassword = options.userPassword.trim()
    if (!userPassword) {
      throw new DocumentError('INVALID_PDF', 'La contraseña de apertura no puede estar vacía')
    }

    const doc = this.documents.getDocument(id)

    let pdf: PDFDocument
    try {
      pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    const p = options.permissions
    pdf.encrypt({
      userPassword,
      ownerPassword: options.ownerPassword?.trim() || userPassword,
      permissions: {
        printing: p.printing ? 'highResolution' : false,
        modifying: p.modifying,
        copying: p.copying,
        annotating: p.modifying,
        fillingForms: p.modifying,
        contentAccessibility: p.copying,
        documentAssembly: p.modifying
      }
    })

    const encrypted = await pdf.save()

    const suggested = doc.fileName.replace(/\.pdf$/i, '') + '-protegido.pdf'
    const target = await this.files.pickSavePath(window, suggested)
    if (!target) throw new DocumentError('CANCELLED', 'Protección cancelada por el usuario')

    try {
      await this.files.write(target, encrypted)
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el PDF protegido')
    }

    return { filePath: target }
  }
}
