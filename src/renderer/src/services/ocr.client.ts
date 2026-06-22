import type { DocumentId, OcrInputPage, OcrLang, OpenDocumentDTO } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "ocr". La UI nunca llama a window.api directamente. */
class OcrClient {
  async extract(lang: OcrLang, images: string[]): Promise<string> {
    const result = await window.api.ocr.extract(lang, images)
    if (result.ok) return result.data.text
    throw new ClientError(result.error.code, result.error.message)
  }

  async searchable(id: DocumentId, lang: OcrLang, pages: OcrInputPage[]): Promise<OpenDocumentDTO> {
    const result = await window.api.ocr.searchable(id, lang, pages)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async saveText(text: string): Promise<string> {
    const result = await window.api.ocr.saveText(text)
    if (result.ok) return result.data.filePath
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const ocrClient = new OcrClient()
