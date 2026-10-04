import type { ImageFormat, ImagePageSize } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "convert". La UI nunca llama a window.api directamente. */
class ConvertClient {
  /** Empieza una exportación a imágenes (pide la carpeta). */
  async beginExport(baseName: string, format: ImageFormat, total: number): Promise<{ exportId: string; dir: string }> {
    const result = await window.api.convert.beginExport(baseName, format, total)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async writeImage(exportId: string, pageNumber: number, data: Uint8Array): Promise<void> {
    const result = await window.api.convert.writeImage(exportId, pageNumber, data)
    if (!result.ok) throw new ClientError(result.error.code, result.error.message)
  }

  async endExport(exportId: string): Promise<{ dir: string; count: number }> {
    const result = await window.api.convert.endExport(exportId)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async imagesToPdf(pageSize: ImagePageSize): Promise<string> {
    const result = await window.api.convert.imagesToPdf(pageSize)
    if (result.ok) return result.data.filePath
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const convertClient = new ConvertClient()
