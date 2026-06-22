import type { Annotation, DocumentId, OpenDocumentDTO } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "annotations". La UI nunca llama a window.api directamente. */
class AnnotationsClient {
  async burn(id: DocumentId, annotations: Annotation[]): Promise<OpenDocumentDTO> {
    const result = await window.api.annotations.burn(id, annotations)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async pickImage(): Promise<{ dataBase64: string; format: 'png' | 'jpg' }> {
    const result = await window.api.annotations.pickImage()
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const annotationsClient = new AnnotationsClient()
