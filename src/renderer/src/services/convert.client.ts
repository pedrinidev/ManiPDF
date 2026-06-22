import type { ImageFormat } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "convert". La UI nunca llama a window.api directamente. */
class ConvertClient {
  async exportImages(format: ImageFormat, images: string[]): Promise<{ dir: string; count: number }> {
    const result = await window.api.convert.exportImages(format, images)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async imagesToPdf(): Promise<string> {
    const result = await window.api.convert.imagesToPdf()
    if (result.ok) return result.data.filePath
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const convertClient = new ConvertClient()
