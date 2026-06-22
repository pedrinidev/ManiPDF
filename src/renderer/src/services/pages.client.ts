import type { IpcResult, OpenDocumentDTO, DocumentId, RotationDelta } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/**
 * Cliente del módulo "pages". Igual que documentClient: desempaqueta el
 * IpcResult y traduce los fallos a ClientError. La UI nunca llama a window.api.
 */
class PagesClient {
  private unwrap<T>(result: IpcResult<T>): T {
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  rotate(id: DocumentId, pageIndices: number[], delta: RotationDelta): Promise<OpenDocumentDTO> {
    return window.api.pages.rotate(id, pageIndices, delta).then((r) => this.unwrap(r))
  }

  remove(id: DocumentId, pageIndices: number[]): Promise<OpenDocumentDTO> {
    return window.api.pages.remove(id, pageIndices).then((r) => this.unwrap(r))
  }

  reorder(id: DocumentId, order: number[]): Promise<OpenDocumentDTO> {
    return window.api.pages.reorder(id, order).then((r) => this.unwrap(r))
  }

  duplicate(id: DocumentId, pageIndices: number[]): Promise<OpenDocumentDTO> {
    return window.api.pages.duplicate(id, pageIndices).then((r) => this.unwrap(r))
  }

  insert(id: DocumentId, atIndex: number): Promise<OpenDocumentDTO> {
    return window.api.pages.insert(id, atIndex).then((r) => this.unwrap(r))
  }

  async extract(id: DocumentId, pageIndices: number[]): Promise<string> {
    return this.unwrap(await window.api.pages.extract(id, pageIndices)).filePath
  }
}

export const pagesClient = new PagesClient()
