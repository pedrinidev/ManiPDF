import type {
  DocumentId,
  FormFieldDTO,
  FormFieldValue,
  NewFormField,
  OpenDocumentDTO
} from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "forms". La UI nunca llama a window.api directamente. */
class FormsClient {
  async list(id: DocumentId): Promise<FormFieldDTO[]> {
    const result = await window.api.forms.list(id)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async fill(id: DocumentId, values: FormFieldValue[], flatten: boolean): Promise<OpenDocumentDTO> {
    const result = await window.api.forms.fill(id, values, flatten)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async create(id: DocumentId, fields: NewFormField[]): Promise<OpenDocumentDTO> {
    const result = await window.api.forms.create(id, fields)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const formsClient = new FormsClient()
