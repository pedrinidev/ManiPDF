import { Buffer } from 'node:buffer'
import { createWorker, type Worker } from 'tesseract.js'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import type { DocumentId, OcrInputPage, OcrLang, OpenDocumentDTO } from '@shared/ipc-contract'

/** Palabra reconocida con su caja en píxeles de la imagen. */
interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Lógica del módulo "ocr". Usa tesseract.js EN NODE (proceso main): así el
 * modelo de idioma se descarga una vez y se cachea en disco, y se evita la
 * CSP del renderer. El renderer solo aporta las páginas ya rasterizadas.
 *
 * Nota: la primera ejecución descarga el modelo del idioma (requiere internet).
 */
export class OcrService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService
  ) {}

  /** Extrae todo el texto de las imágenes (una por página). */
  async extract(lang: OcrLang, images: string[]): Promise<{ text: string }> {
    if (images.length === 0) throw new DocumentError('INVALID_PDF', 'No hay páginas para OCR')

    const worker = await this.makeWorker(lang)
    try {
      const parts: string[] = []
      for (let i = 0; i < images.length; i++) {
        const { data } = await worker.recognize(Buffer.from(images[i], 'base64'))
        parts.push(`--- Página ${i + 1} ---\n${data.text.trim()}`)
      }
      return { text: parts.join('\n\n') }
    } finally {
      await worker.terminate()
    }
  }

  /** Crea un PDF buscable: imagen de cada página + capa de texto invisible. */
  async searchable(id: DocumentId, lang: OcrLang, pages: OcrInputPage[]): Promise<OpenDocumentDTO> {
    if (pages.length === 0) throw new DocumentError('INVALID_PDF', 'No hay páginas para OCR')
    const doc = this.documents.getDocument(id)

    const worker = await this.makeWorker(lang)
    try {
      const out = await PDFDocument.create()
      const font = await out.embedFont(StandardFonts.Helvetica)

      for (const page of pages) {
        const buffer = Buffer.from(page.jpegBase64, 'base64')
        const { data } = await worker.recognize(buffer)
        const words = extractWords(data)

        const jpg = await out.embedJpg(buffer)
        const pdfPage = out.addPage([page.widthPt, page.heightPt])
        pdfPage.drawImage(jpg, { x: 0, y: 0, width: page.widthPt, height: page.heightPt })
        this.drawInvisibleText(pdfPage, words, page, font)
      }

      doc.replaceBytes(await out.save())
      return this.documents.describe(id)
    } finally {
      await worker.terminate()
    }
  }

  /** Guarda un texto en un archivo .txt. */
  async saveText(text: string, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const target = await this.files.pickSaveTextPath(window, 'texto-ocr.txt')
    if (!target) throw new DocumentError('CANCELLED', 'Guardado cancelado por el usuario')
    try {
      await this.files.write(target, new TextEncoder().encode(text))
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo de texto')
    }
    return { filePath: target }
  }

  // -- helpers --------------------------------------------------------------

  private async makeWorker(lang: OcrLang): Promise<Worker> {
    return createWorker(lang)
  }

  /** Dibuja cada palabra con opacidad 0: invisible pero seleccionable/buscable. */
  private drawInvisibleText(
    page: PDFPage,
    words: OcrWord[],
    src: OcrInputPage,
    font: PDFFont
  ): void {
    const sx = src.widthPt / src.imgWidthPx
    const sy = src.heightPt / src.imgHeightPx

    for (const w of words) {
      const text = w.text.trim()
      if (!text) continue
      const size = Math.max(1, (w.y1 - w.y0) * sy)
      const x = w.x0 * sx
      const y = src.heightPt - w.y1 * sy // baseline aproximada
      try {
        page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0), opacity: 0 })
      } catch {
        // Carácter no soportado por la fuente estándar: se omite esa palabra.
      }
    }
  }
}

/** Aplana los bloques de tesseract a una lista de palabras con caja. */
function extractWords(data: { blocks: unknown }): OcrWord[] {
  const words: OcrWord[] = []
  const blocks = (data.blocks ?? []) as Array<{
    paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: OcrWord }> }> }>
  }>
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          words.push({
            text: word.text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1
          })
        }
      }
    }
  }
  return words
}
