import type { DocumentId } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "combine". La UI nunca llama a window.api directamente. */
class CombineClient {
  async merge(): Promise<{ filePath: string; pageCount: number }> {
    const result = await window.api.combine.merge()
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async split(id: DocumentId, everyN: number): Promise<{ dir: string; count: number }> {
    const result = await window.api.combine.split(id, everyN)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const combineClient = new CombineClient()
