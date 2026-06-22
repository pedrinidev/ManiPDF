import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { DocumentId } from '@shared/ipc-contract'

/**
 * Modelo de dominio de un documento PDF abierto.
 *
 * Es deliberadamente "tonto": guarda estado, no sabe leer/escribir disco
 * ni renderizar. Las operaciones de I/O y de PDF viven en los services.
 * Esto lo hace testeable sin Electron ni sistema de archivos.
 */
export class PdfDocument {
  readonly id: DocumentId
  /** Ruta en disco. null = documento nuevo aún no guardado. */
  filePath: string | null
  /** Contenido binario actual del PDF. */
  bytes: Uint8Array
  /** true si hay cambios sin guardar. */
  isDirty: boolean

  private constructor(id: DocumentId, filePath: string | null, bytes: Uint8Array) {
    this.id = id
    this.filePath = filePath
    this.bytes = bytes
    this.isDirty = false
  }

  /** Crea un documento a partir de bytes leídos de disco. */
  static fromBytes(bytes: Uint8Array, filePath: string | null): PdfDocument {
    return new PdfDocument(randomUUID(), filePath, bytes)
  }

  /** Nombre de archivo para mostrar en la UI. */
  get fileName(): string {
    return this.filePath ? basename(this.filePath) : 'Sin título.pdf'
  }

  /** Reemplaza el contenido binario (tras una edición) y marca como modificado. */
  replaceBytes(bytes: Uint8Array): void {
    this.bytes = bytes
    this.isDirty = true
  }

  /** Marca el documento como guardado en la ruta indicada. */
  markSaved(filePath: string): void {
    this.filePath = filePath
    this.isDirty = false
  }
}
