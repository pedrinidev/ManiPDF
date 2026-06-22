import { Buffer } from 'node:buffer'
import { PDFDocument } from 'pdf-lib'
import { DocumentService, DocumentError } from './document.service'
import type { DocumentId, OpenDocumentDTO, RasterPage } from '@shared/ipc-contract'

/**
 * Lógica del módulo "optimize". Dos estrategias de compresión:
 *
 *  - lossless: reconstruye el PDF copiando páginas a un documento nuevo, lo que
 *    descarta objetos huérfanos, y guarda con object streams. Mantiene texto e
 *    imágenes; ganancia modesta.
 *  - rebuildFromImages: reensambla el PDF a partir de páginas ya rasterizadas
 *    a JPEG por el renderer. Reduce mucho en PDFs con imágenes, pero el texto
 *    deja de ser seleccionable (con pérdida).
 *
 * El render a imagen se hace en el renderer (donde está el canvas); aquí solo
 * se reensambla. Así cada proceso hace lo suyo.
 */
export class OptimizeService {
  constructor(private readonly documents: DocumentService) {}

  async lossless(id: DocumentId): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)

    let src: PDFDocument
    try {
      src = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))

    const bytes = await out.save({ useObjectStreams: true })
    // Solo nos quedamos con la versión optimizada si realmente es más pequeña.
    if (bytes.length < doc.bytes.length) doc.replaceBytes(bytes)
    return this.documents.describe(id)
  }

  async rebuildFromImages(id: DocumentId, pages: RasterPage[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    if (pages.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No se recibió ninguna página rasterizada')
    }

    const out = await PDFDocument.create()
    for (const page of pages) {
      const jpg = await out.embedJpg(Buffer.from(page.jpegBase64, 'base64'))
      const p = out.addPage([page.widthPt, page.heightPt])
      p.drawImage(jpg, { x: 0, y: 0, width: page.widthPt, height: page.heightPt })
    }

    doc.replaceBytes(await out.save({ useObjectStreams: true }))
    return this.documents.describe(id)
  }
}
