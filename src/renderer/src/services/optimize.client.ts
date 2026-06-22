import type { DocumentId, OpenDocumentDTO, RasterPage } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "optimize". La UI nunca llama a window.api directamente. */
class OptimizeClient {
  private unwrap(result: { ok: true; data: OpenDocumentDTO } | { ok: false; error: { code: string; message: string } }): OpenDocumentDTO {
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async lossless(id: DocumentId): Promise<OpenDocumentDTO> {
    return this.unwrap(await window.api.optimize.lossless(id))
  }

  async rebuildFromImages(id: DocumentId, pages: RasterPage[]): Promise<OpenDocumentDTO> {
    return this.unwrap(await window.api.optimize.rebuildFromImages(id, pages))
  }
}

export const optimizeClient = new OptimizeClient()
