import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

// OCR simulado: «reconoce» siempre las mismas palabras, con su caja en píxeles de
// la imagen recibida (que en estas pruebas mide 1000×500 px).
vi.mock('tesseract.js', () => ({
  createWorker: async () => ({
    recognize: async () => ({
      data: {
        text: 'Factura escaneada',
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      { text: 'Factura', bbox: { x0: 100, y0: 50, x1: 300, y1: 100 } },
                      { text: 'escaneada', bbox: { x0: 320, y0: 50, x1: 600, y1: 100 } }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }),
    terminate: async () => {}
  })
}))

import { OcrService } from './ocr.service'
import { DocumentService } from './document.service'
import { FileService } from './file.service'
import type { OcrInputPage } from '@shared/ipc-contract'

const IMAGE = { jpegBase64: '/9j/2wBD', imgWidthPx: 1000, imgHeightPx: 500 }

let dir = ''
let docs: DocumentService
let ocr: OcrService

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manipdf-ocr-'))
  // Modelo «en caché»: así no se descarga nada (el OCR está simulado).
  await writeFile(join(dir, 'spa.traineddata'), 'modelo')
  const files = new FileService()
  docs = new DocumentService(files)
  ocr = new OcrService(docs, files, { cacheDir: dir, modelBaseUrl: 'http://127.0.0.1:9' })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Página 1: texto vectorial + campo de formulario. Página 2: «escaneada» (sin
 * texto), girada 90°. Página 3: «escaneada», con CropBox desplazada.
 */
async function openSample(): Promise<{ id: string; revision: number }> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const first = pdf.addPage([400, 300])
  first.drawText('Texto original', { x: 40, y: 200, size: 14, font })
  pdf.getForm().createTextField('nombre').addToPage(first, { x: 40, y: 100, width: 200, height: 24 })

  const rotated = pdf.addPage([300, 600]) // se ve como 600×300
  rotated.setRotation(degrees(90))

  const cropped = pdf.addPage([600, 800])
  cropped.setCropBox(100, 200, 500, 250) // se ve como 500×250

  const file = join(dir, 'muestra.pdf')
  await writeFile(file, await pdf.save())
  return docs.openPath(file)
}

async function textOf(data: Uint8Array): Promise<{ page: pdfjs.PDFPageProxy; items: TextItem[] }[]> {
  const pdf = await pdfjs.getDocument({ data: data.slice(), verbosity: 0 }).promise
  const pages = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    pages.push({ page, items: content.items.filter((i): i is TextItem => 'str' in i && i.str.trim() !== '') })
  }
  return pages
}

/** Origen (línea base) y orientación de un texto tal como se ve en pantalla. */
function onScreen(page: pdfjs.PDFPageProxy, item: TextItem): { x: number; y: number; upright: boolean } {
  const [a, b, c, d, x, y] = pdfjs.Util.transform(page.getViewport({ scale: 1 }).transform, item.transform)
  return { x, y, upright: a > 0 && Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6 && d < 0 }
}

describe('PDF buscable sobre las páginas originales (M10)', () => {
  it('conserva el texto vectorial y el formulario y añade el texto reconocido en su sitio', async () => {
    const doc = await openSample()
    const pages: OcrInputPage[] = [
      { pageNumber: 2, ...IMAGE },
      { pageNumber: 3, ...IMAGE }
    ]
    const updated = await ocr.searchable(doc.id, 'spa', pages, doc.revision)

    // Antes se sustituía el documento por imágenes: sin texto y sin formulario.
    const out = await PDFDocument.load(updated.data)
    expect(out.getPageCount()).toBe(3)
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['nombre'])
    expect(out.getPage(1).getRotation().angle).toBe(90)

    const [first, rotated, cropped] = await textOf(updated.data)
    expect(first.items.map((i) => i.str)).toEqual(['Texto original'])

    // Página girada (600×300 en pantalla; la imagen, 1000×500 px → 0,6 pt/px).
    expect(rotated.items.map((i) => i.str)).toEqual(['Factura', 'escaneada'])
    const word = onScreen(rotated.page, rotated.items[0])
    expect(word.upright).toBe(true)
    expect(word.x).toBeCloseTo(60, 0) // x0 = 100 px
    expect(word.y).toBeGreaterThan(30) // la línea base cae dentro de la caja (y 30–60)
    expect(word.y).toBeLessThanOrEqual(60)

    // Página recortada (500×250 en pantalla → 0,5 pt/px), relativa a la CropBox.
    expect(cropped.items.map((i) => i.str)).toEqual(['Factura', 'escaneada'])
    const second = onScreen(cropped.page, cropped.items[1])
    expect(second.upright).toBe(true)
    expect(second.x).toBeCloseTo(160, 0) // x0 = 320 px
    expect(second.y).toBeGreaterThan(25)
    expect(second.y).toBeLessThanOrEqual(50)
  })

  it('rechaza páginas repetidas o fuera de rango y versiones anteriores', async () => {
    const doc = await openSample()
    await expect(
      ocr.searchable(doc.id, 'spa', [{ pageNumber: 4, ...IMAGE }], doc.revision)
    ).rejects.toMatchObject({ code: 'INVALID_PDF' })
    await expect(
      ocr.searchable(doc.id, 'spa', [{ pageNumber: 2, ...IMAGE }, { pageNumber: 2, ...IMAGE }], doc.revision)
    ).rejects.toMatchObject({ code: 'INVALID_PDF' })
    await expect(
      ocr.searchable(doc.id, 'spa', [{ pageNumber: 2, ...IMAGE }], doc.revision - 1)
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('rechaza idiomas no admitidos (el código acaba en una ruta de archivo)', async () => {
    const doc = await openSample()
    const lang = '../../evil' as unknown as 'spa'
    await expect(ocr.searchable(doc.id, lang, [{ pageNumber: 2, ...IMAGE }], doc.revision)).rejects.toThrow(
      /no admitido/
    )
  })
})
