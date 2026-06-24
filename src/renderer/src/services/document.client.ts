import type {
  IpcResult,
  OpenDocumentDTO,
  DocumentMetadataDTO,
  DocumentId
} from '@shared/ipc-contract'

/**
 * Cliente de servicios del renderer.
 *
 * La UI SIEMPRE pasa por aquí, nunca llama a `window.api` directamente.
 * Centralizar esto permite, por ejemplo, añadir logging, reintentos o
 * desempaquetar el IpcResult en un solo lugar.
 */
class DocumentClient {
  /** Desempaqueta un IpcResult: devuelve data o lanza un Error legible. */
  private unwrap<T>(result: IpcResult<T>): T {
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async open(): Promise<OpenDocumentDTO> {
    return this.unwrap(await window.api.document.open())
  }

  async openPath(filePath: string): Promise<OpenDocumentDTO> {
    return this.unwrap(await window.api.document.openPath(filePath))
  }

  async save(id: DocumentId): Promise<string> {
    return this.unwrap(await window.api.document.save(id)).filePath
  }

  async saveAs(id: DocumentId): Promise<string> {
    return this.unwrap(await window.api.document.saveAs(id)).filePath
  }

  async metadata(id: DocumentId): Promise<DocumentMetadataDTO> {
    return this.unwrap(await window.api.document.metadata(id))
  }

  /** Descifra en memoria un PDF protegido (con la contraseña) para poder editarlo. */
  async unlock(id: DocumentId, password: string): Promise<OpenDocumentDTO> {
    return this.unwrap(await window.api.document.unlock(id, password))
  }

  async close(id: DocumentId): Promise<void> {
    this.unwrap(await window.api.document.close(id))
  }

  /** Abre el diálogo de impresión del SO. Devuelve true si se envió a imprimir. */
  async print(id: DocumentId): Promise<boolean> {
    return this.unwrap(await window.api.document.print(id)).printed
  }

  /** Exporta una copia del documento a un PDF nuevo. Devuelve la ruta. */
  async exportCopy(id: DocumentId): Promise<string> {
    return this.unwrap(await window.api.document.exportCopy(id)).filePath
  }

  /** Restaura el documento a un snapshot anterior (deshacer/rehacer). */
  async restore(id: DocumentId, data: Uint8Array): Promise<OpenDocumentDTO> {
    return this.unwrap(await window.api.document.restore(id, data))
  }
}

/** Error del lado cliente que conserva el código del IpcError original. */
export class ClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ClientError'
  }

  /** true si el "error" es realmente una cancelación del usuario (no mostrar alerta). */
  get isCancellation(): boolean {
    return this.code === 'CANCELLED'
  }
}

export const documentClient = new DocumentClient()
