import { Buffer } from 'node:buffer'
import { basename } from 'node:path'
import type { BrowserWindow } from 'electron'
import { DocumentError } from './document.service'
import { FileService } from './file.service'

/**
 * Lógica del módulo "compare". Solo se encarga de elegir y leer el segundo PDF;
 * la extracción de texto y el diff se hacen en el renderer (con pdf.js).
 */
export class CompareService {
  constructor(private readonly files: FileService) {}

  async pick(window: BrowserWindow | null): Promise<{ dataBase64: string; fileName: string }> {
    const path = await this.files.pickOpenPath(window)
    if (!path) throw new DocumentError('CANCELLED', 'Comparación cancelada por el usuario')

    let bytes: Uint8Array
    try {
      bytes = await this.files.read(path)
    } catch {
      throw new DocumentError('NOT_FOUND', 'No se pudo leer el segundo PDF')
    }
    return { dataBase64: Buffer.from(bytes).toString('base64'), fileName: basename(path) }
  }
}
