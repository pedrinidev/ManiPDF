import { Buffer } from 'node:buffer'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import type {
  Annotation,
  DocumentId,
  ImageAnnotation,
  OpenDocumentDTO,
  RectArea
} from '@shared/ipc-contract'

const NOTE_FONT_SIZE = 10
const NOTE_PADDING = 4
const NOTE_LINE_GAP = 2
const NOTE_BOX_WIDTH = 200 // ancho fijo de la nota (pt), tipo nota adhesiva
const TEXT_MAX_WIDTH_FRAC = 0.6 // coincide con el max-width 60% del overlay

/**
 * Lógica del módulo "annotations". "Graba" (burn) las anotaciones que el
 * usuario dibujó en el overlay del renderer dentro del contenido del PDF,
 * usando pdf-lib. Las coordenadas llegan normalizadas (0..1, origen arriba);
 * aquí se convierten a puntos PDF (origen abajo-izquierda).
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
    const doc = this.documents.getDocument(id)
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
      // Las imágenes requieren embebido asíncrono; el resto es síncrono.
      if (ann.type === 'image') {
        await this.drawImage(pdf, page, ann)
      } else {
        this.draw(page, ann, font)
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
    ann: ImageAnnotation
  ): Promise<void> {
    const { width: W, height: H } = page.getSize()
    const bytes = Buffer.from(ann.dataBase64, 'base64')
    const image = ann.format === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
    page.drawImage(image, toPdfRect(ann.rect, W, H))
  }

  private draw(page: PDFPage, ann: Annotation, font: PDFFont): void {
    const { width: W, height: H } = page.getSize()
    const color = hexToRgb(ann.color)

    switch (ann.type) {
      case 'highlight': {
        const r = toPdfRect(ann.rect, W, H)
        page.drawRectangle({ ...r, color, opacity: 0.35 })
        break
      }
      case 'rect': {
        const r = toPdfRect(ann.rect, W, H)
        page.drawRectangle({ ...r, borderColor: color, borderWidth: 1.5, opacity: 0 })
        break
      }
      case 'underline': {
        const r = toPdfRect(ann.rect, W, H)
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
        this.drawNote(page, ann.pos, ann.text, color, W, H, font)
        break
      case 'text': {
        const size = Math.max(4, ann.size * H)
        const x0 = ann.pos.x * W
        // Ajuste de línea como en pantalla (max-width 60%), sin salirse de la hoja.
        const maxWidth = Math.max(40, Math.min(W * TEXT_MAX_WIDTH_FRAC, W - x0 - 4))
        const lines = wrapLines(ann.text || '', font, size, maxWidth)
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
    // Ancho FIJO con ajuste de línea (como la nota adhesiva de pantalla); así no
    // se convierte en una tira que se sale de la hoja.
    const innerW = NOTE_BOX_WIDTH - NOTE_PADDING * 2
    const lines = wrapLines(text || '(nota)', font, NOTE_FONT_SIZE, innerW)
    const boxW = NOTE_BOX_WIDTH
    const boxH = lines.length * (NOTE_FONT_SIZE + NOTE_LINE_GAP) + NOTE_PADDING * 2

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
      opacity: 0.85,
      borderColor: rgb(0.6, 0.5, 0),
      borderWidth: 0.5
    })

    lines.forEach((line, i) => {
      page.drawText(line, {
        x: left + NOTE_PADDING,
        y: top - NOTE_PADDING - NOTE_FONT_SIZE - i * (NOTE_FONT_SIZE + NOTE_LINE_GAP),
        size: NOTE_FONT_SIZE,
        font,
        color: rgb(0.1, 0.1, 0.1)
      })
    })
  }
}

/** Convierte un rect normalizado (origen arriba) a coords PDF (origen abajo). */
function toPdfRect(
  rect: RectArea,
  W: number,
  H: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x * W,
    y: H - (rect.y + rect.h) * H,
    width: rect.w * W,
    height: rect.h * H
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
