import type { DocumentId, OpenDocumentDTO, RedactedPage } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "redact". La UI nunca llama a window.api directamente. */
class RedactClient {
  async apply(id: DocumentId, pages: RedactedPage[]): Promise<OpenDocumentDTO> {
    const result = await window.api.redact.apply(id, pages)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const redactClient = new RedactClient()
