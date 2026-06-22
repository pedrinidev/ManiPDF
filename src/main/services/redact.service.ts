import { Buffer } from 'node:buffer'
import { PDFDocument } from 'pdf-lib'
import { DocumentService, DocumentError } from './document.service'
import type { DocumentId, OpenDocumentDTO, RedactedPage } from '@shared/ipc-contract'

/**
 * Lógica del módulo "redact". Reconstruye el PDF: las páginas con zonas tachadas
 * se reemplazan por su imagen rasterizada (con los recuadros negros ya quemados
 * por el renderer), de modo que el contenido bajo el recuadro DESAPARECE. Las
 * páginas sin redacción se copian intactas (conservan su texto).
 */
export class RedactService {
  constructor(private readonly documents: DocumentService) {}

  async apply(id: DocumentId, redacted: RedactedPage[]): Promise<OpenDocumentDTO> {
    if (redacted.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No se marcó ninguna zona para redactar')
    }
    const doc = this.documents.getDocument(id)

    let src: PDFDocument
    try {
      src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    const byIndex = new Map(redacted.map((p) => [p.pageIndex, p]))
    const out = await PDFDocument.create()
    const totalPages = src.getPageCount()

    for (let i = 0; i < totalPages; i++) {
      const red = byIndex.get(i)
      if (red) {
        // Página redactada: insertamos la imagen aplanada (contenido eliminado).
        const jpg = await out.embedJpg(Buffer.from(red.jpegBase64, 'base64'))
        const page = out.addPage([red.widthPt, red.heightPt])
        page.drawImage(jpg, { x: 0, y: 0, width: red.widthPt, height: red.heightPt })
      } else {
        // Página intacta: se copia tal cual (mantiene el texto).
        const [copied] = await out.copyPages(src, [i])
        out.addPage(copied)
      }
    }

    doc.replaceBytes(await out.save())
    return this.documents.describe(id)
  }
}
