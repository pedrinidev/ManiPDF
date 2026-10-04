import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { DocumentService, DocumentError } from './document.service'
import { drawInFrame, pageFrame, type PageFrame } from './page-frame'
import { toEncodable } from './winansi'
import type { DocumentId, HeaderFooter, OpenDocumentDTO, StampConfig } from '@shared/ipc-contract'

const WATERMARK_ANGLE = 45

/**
 * Lógica del módulo "stamp": marca de agua, encabezado/pie y numeración.
 * Todo con pdf-lib (`drawText`). Los textos admiten {page}, {total}, {date}.
 * Se dibuja en el marco de la página TAL COMO SE VE: en una página girada el pie
 * queda abajo y derecho (antes salía en un lateral y girado).
 */
export class StampService {
  constructor(private readonly documents: DocumentService) {}

  async apply(id: DocumentId, config: StampConfig): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id)

    let pdf: PDFDocument
    try {
      pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const pages = pdf.getPages()
    const total = pages.length
    const date = new Date().toLocaleDateString('es-ES')

    pages.forEach((page, i) => {
      const ctx = { page: i + 1, total, date }
      const frame = pageFrame(page)
      drawInFrame(page, frame, () => {
        this.drawWatermark(page, frame, config, font)
        this.drawBand(page, frame, config.header, true, config, font, ctx)
        this.drawBand(page, frame, config.footer, false, config, font, ctx)
      })
    })

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  private drawWatermark(page: PDFPage, frame: PageFrame, config: StampConfig, font: PDFFont): void {
    const text = toEncodable(config.watermarkText.trim(), font)
    if (!text) return

    const { width: W, height: H } = frame
    const size = Math.max(8, Math.min(W, H) * 0.08)
    const color = hexToRgb(config.watermarkColor)
    const textWidth = font.widthOfTextAtSize(text, size)

    if (config.watermarkDiagonal) {
      const rad = (WATERMARK_ANGLE * Math.PI) / 180
      page.drawText(text, {
        x: W / 2 - (textWidth / 2) * Math.cos(rad),
        y: H / 2 - (textWidth / 2) * Math.sin(rad),
        size,
        font,
        color,
        opacity: config.watermarkOpacity,
        rotate: degrees(WATERMARK_ANGLE)
      })
    } else {
      page.drawText(text, {
        x: (W - textWidth) / 2,
        y: H / 2,
        size,
        font,
        color,
        opacity: config.watermarkOpacity
      })
    }
  }

  private drawBand(
    page: PDFPage,
    frame: PageFrame,
    band: HeaderFooter,
    isHeader: boolean,
    config: StampConfig,
    font: PDFFont,
    ctx: { page: number; total: number; date: string }
  ): void {
    const { width: W, height: H } = frame
    const size = config.hfFontSize
    const color = hexToRgb(config.hfColor)
    const y = isHeader ? H - config.margin - size : config.margin

    const cells: [string, 'left' | 'center' | 'right'][] = [
      [band.left, 'left'],
      [band.center, 'center'],
      [band.right, 'right']
    ]

    for (const [raw, align] of cells) {
      const text = toEncodable(fillPlaceholders(raw, ctx).trim(), font)
      if (!text) continue
      const textWidth = font.widthOfTextAtSize(text, size)
      const x =
        align === 'left'
          ? config.margin
          : align === 'center'
            ? (W - textWidth) / 2
            : W - config.margin - textWidth
      page.drawText(text, { x, y, size, font, color })
    }
  }
}

function fillPlaceholders(text: string, ctx: { page: number; total: number; date: string }): string {
  return text
    .replace(/\{page\}/g, String(ctx.page))
    .replace(/\{total\}/g, String(ctx.total))
    .replace(/\{date\}/g, ctx.date)
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return rgb(isFinite(r) ? r : 0, isFinite(g) ? g : 0, isFinite(b) ? b : 0)
}
