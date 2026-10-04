import { Buffer } from 'node:buffer'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import { bytesFromBase64 } from './base64'
import { drawInFrame, frameBox, pageFrame, type PageFrame } from './page-frame'
import { toEncodable } from './winansi'
import type { Annotation, DocumentId, ImageAnnotation, OpenDocumentDTO } from '@shared/ipc-contract'

// Notas: tamaños relativos a la página para que el PDF grabado coincida con la
// nota del overlay (que usa unidades cq* a 1.5cqh / 36cqw / padding 0.6cqh).
const NOTE_SIZE_FRAC = 0.015 // fuente como fracción de la ALTURA de página
const NOTE_PADDING_FRAC = 0.006 // padding como fracción de la ALTURA de página
const NOTE_MAX_WIDTH_FRAC = 0.36 // ancho máx. como fracción del ANCHO de página
const NOTE_LINE_GAP_FRAC = 0.2 // separación entre líneas, fracción del tamaño
const TEXT_MAX_WIDTH_FRAC = 0.6 // coincide con el max-width 60% del overlay

/**
 * Lógica del módulo "annotations". "Graba" (burn) las anotaciones que el
 * usuario dibujó en el overlay del renderer dentro del contenido del PDF,
 * usando pdf-lib. Las coordenadas llegan normalizadas (0..1, origen arriba) y
 * relativas a la página TAL COMO SE VE: se dibuja en ese marco (`page-frame.ts`),
 * así lo grabado queda donde se colocó y derecho también en páginas giradas o
 * recortadas. Los textos se adaptan a la fuente estándar (`winansi.ts`).
 *
 * Limitación conocida: las anotaciones se aplanan en el contenido (no quedan
 * como objetos de anotación re-editables al reabrir). Es una mejora futura.
 */
export class AnnotationsService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService
  ) {}

  async burn(id: DocumentId, annotations: Annotation[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id)
    if (annotations.length === 0) return this.documents.describe(id)

    let pdf: PDFDocument
    try {
      pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const pages = pdf.getPages()

    for (const ann of annotations) {
      const page = pages[ann.page - 1]
      if (!page) continue
      const frame = pageFrame(page)
      // Las imágenes requieren embebido asíncrono; el resto es síncrono.
      if (ann.type === 'image') {
        await this.drawImage(pdf, page, ann, frame)
      } else {
        drawInFrame(page, frame, () => this.draw(page, ann, font, frame))
      }
    }

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Abre un diálogo para elegir una imagen (firma) y la devuelve en base64. */
  async pickImage(
    window: BrowserWindow | null
  ): Promise<{ dataBase64: string; format: 'png' | 'jpg' }> {
    const paths = await this.files.pickOpenImages(window)
    if (paths.length === 0) throw new DocumentError('CANCELLED', 'Selección cancelada')

    const path = paths[0]
    const bytes = await this.files.read(path)
    const format: 'png' | 'jpg' = /\.png$/i.test(path) ? 'png' : 'jpg'
    return { dataBase64: Buffer.from(bytes).toString('base64'), format }
  }

  /** Embebe y dibuja una imagen (firma) en la página. */
  private async drawImage(
    pdf: PDFDocument,
    page: PDFPage,
    ann: ImageAnnotation,
    frame: PageFrame
  ): Promise<void> {
    const bytes = bytesFromBase64(ann.dataBase64)
    const image = ann.format === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    drawInFrame(page, frame, () => page.drawImage(image, frameBox(ann.rect, frame)))
  }

  /** Dibuja una anotación en el marco visible de la página (coordenadas del marco). */
  private draw(page: PDFPage, ann: Annotation, font: PDFFont, frame: PageFrame): void {
    const { width: W, height: H } = frame
    const color = hexToRgb(ann.color)

    switch (ann.type) {
      case 'highlight': {
        const r = frameBox(ann.rect, frame)
        page.drawRectangle({ ...r, color, opacity: 0.35 })
        break
      }
      case 'rect': {
        const r = frameBox(ann.rect, frame)
        page.drawRectangle({ ...r, borderColor: color, borderWidth: 1.5, opacity: 0 })
        break
      }
      case 'underline': {
        const r = frameBox(ann.rect, frame)
        const thickness = Math.max(1, 0.004 * H)
        page.drawRectangle({
          x: r.x,
          y: r.y,
          width: r.width,
          height: thickness,
          color
        })
        break
      }
      case 'ink': {
        const thickness = Math.max(0.75, ann.width * W)
        for (let i = 1; i < ann.points.length; i++) {
          const a = ann.points[i - 1]
          const b = ann.points[i]
          page.drawLine({
            start: { x: a.x * W, y: H - a.y * H },
            end: { x: b.x * W, y: H - b.y * H },
            thickness,
            color
          })
        }
        break
      }
      case 'note':
        this.drawNote(page, ann.pos, toEncodable(ann.text, font), color, W, H, font)
        break
      case 'text': {
        const size = Math.max(4, ann.size * H)
        const x0 = ann.pos.x * W
        // Ajuste de línea como en pantalla (max-width 60%), sin salirse de la hoja.
        const maxWidth = Math.max(40, Math.min(W * TEXT_MAX_WIDTH_FRAC, W - x0 - 4))
        const lines = wrapLines(toEncodable(ann.text || '', font), font, size, maxWidth)
        lines.forEach((line, i) => {
          try {
            page.drawText(line, {
              x: x0,
              y: H - ann.pos.y * H - size - i * (size * 1.25),
              size,
              font,
              color
            })
          } catch {
            // Carácter no soportado por la fuente estándar: se omite la línea.
          }
        })
        break
      }
    }
  }

  private drawNote(
    page: PDFPage,
    pos: { x: number; y: number },
    text: string,
    color: RGB,
    W: number,
    H: number,
    font: PDFFont
  ): void {
    // Tamaños proporcionales a la página (igual que el overlay) y caja AJUSTADA
    // AL CONTENIDO (no fija), como la nota adhesiva de pantalla.
    const fontSize = NOTE_SIZE_FRAC * H
    const padding = NOTE_PADDING_FRAC * H
    const lineGap = fontSize * NOTE_LINE_GAP_FRAC
    const maxInnerW = NOTE_MAX_WIDTH_FRAC * W - padding * 2

    const lines = wrapLines(text || '(nota)', font, fontSize, maxInnerW)
    const contentW = Math.max(
      fontSize,
      ...lines.map((l) => font.widthOfTextAtSize(l, fontSize))
    )
    const innerW = Math.min(contentW, maxInnerW)
    const boxW = innerW + padding * 2
    const boxH = lines.length * (fontSize + lineGap) + padding * 2

    // Si no cabe a la derecha, se desplaza para no salirse de la página.
    let left = pos.x * W
    if (left + boxW > W) left = Math.max(0, W - boxW)
    const top = H - pos.y * H

    // Fondo tipo nota adhesiva + borde.
    page.drawRectangle({
      x: left,
      y: top - boxH,
      width: boxW,
      height: boxH,
      color,
      borderColor: rgb(0.6, 0.5, 0),
      borderWidth: 0.5
    })

    lines.forEach((line, i) => {
      page.drawText(line, {
        x: left + padding,
        y: top - padding - fontSize - i * (fontSize + lineGap),
        size: fontSize,
        font,
        color: rgb(0.13, 0.13, 0.13)
      })
    })
  }
}

/**
 * Parte el texto en líneas que caben en `maxWidth` (puntos), respetando saltos
 * de línea y troceando palabras demasiado largas. Evita que notas/textos se
 * dibujen en una sola línea que se sale de la página.
 */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const fits = (s: string): boolean => s === '' || font.widthOfTextAtSize(s, size) <= maxWidth
  const out: string[] = []
  for (const para of (text || '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word
      if (fits(test)) {
        line = test
        continue
      }
      if (line) {
        out.push(line)
        line = ''
      }
      if (fits(word)) {
        line = word
        continue
      }
      // Palabra más larga que la caja: trocear por caracteres.
      let chunk = ''
      for (const ch of word) {
        if (fits(chunk + ch)) chunk += ch
        else {
          out.push(chunk)
          chunk = ch
        }
      }
      line = chunk
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

function hexToRgb(hex: string): RGB {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return rgb(isFinite(r) ? r : 0, isFinite(g) ? g : 0, isFinite(b) ? b : 0)
}
