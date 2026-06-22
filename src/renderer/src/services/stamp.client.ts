import type { DocumentId, OpenDocumentDTO, StampConfig } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "stamp". La UI nunca llama a window.api directamente. */
class StampClient {
  async apply(id: DocumentId, config: StampConfig): Promise<OpenDocumentDTO> {
    const result = await window.api.stamp.apply(id, config)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const stampClient = new StampClient()
