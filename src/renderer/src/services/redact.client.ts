import type { DocumentId, OpenDocumentDTO, RedactedPage } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "redact". La UI nunca llama a window.api directamente. */
class RedactClient {
  /** `baseRevision`: versión del documento sobre la que se rasterizaron las páginas. */
  async apply(id: DocumentId, pages: RedactedPage[], baseRevision: number): Promise<OpenDocumentDTO> {
    const result = await window.api.redact.apply(id, pages, baseRevision)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const redactClient = new RedactClient()
