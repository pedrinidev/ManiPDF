import type { DocumentId, InkCoverage, SeparationMode, SeparationSpace } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "separations". La UI nunca llama a window.api directamente. */
class SeparationsClient {
  /** Devuelve la página como TIFF (CMYK o RGB) + el espacio usado, para separar los canales. */
  async render(
    id: DocumentId,
    pageNumber: number,
    dpi: number,
    mode: SeparationMode
  ): Promise<{ space: SeparationSpace; tiffBase64: string }> {
    const result = await window.api.separations.render(id, pageNumber, dpi, mode)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async exportFiles(files: { name: string; pngBase64: string }[]): Promise<{ dir: string; count: number }> {
    const result = await window.api.separations.exportFiles(files)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }

  async exportGray(id: DocumentId): Promise<{ filePath: string; ink: InkCoverage | null }> {
    const result = await window.api.separations.exportGray(id)
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const separationsClient = new SeparationsClient()
