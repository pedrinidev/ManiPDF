/**
 * La geometría de «página tal como se ve» se contrasta con pdf.js (el motor del
 * visor) como referencia, en las 4 rotaciones y con CropBox.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'node:path'
import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import { frameBox, pageFrame, toUserBox, widgetPlacement } from './page-frame'

interface Viewport {
  width: number
  height: number
  convertToViewportPoint(x: number, y: number): number[]
  convertToViewportRectangle(rect: number[]): number[]
}

let viewports: Viewport[] = []
let pdfLibDoc: PDFDocument

beforeAll(async () => {
  // Página con CropBox en cada rotación.
  pdfLibDoc = await PDFDocument.create()
  for (const rotation of [0, 90, 180, 270]) {
    const page = pdfLibDoc.addPage([612, 792])
    page.setCropBox(100, 50, 400, 600)
    page.setRotation(degrees(rotation))
  }
  const bytes = await pdfLibDoc.save()

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = join(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise
  viewports = []
  for (let n = 1; n <= doc.numPages; n++) viewports.push((await doc.getPage(n)).getViewport({ scale: 1 }) as Viewport)
  await doc.destroy()
})

describe('pageFrame (coincide con pdf.js)', () => {
  it('el tamaño visible es el de pdf.js en las 4 rotaciones', () => {
    pdfLibDoc.getPages().forEach((page, i) => {
      const frame = pageFrame(page)
      expect(frame.width).toBeCloseTo(viewports[i].width, 3)
      expect(frame.height).toBeCloseTo(viewports[i].height, 3)
    })
  })

  it('un punto del overlay acaba donde pdf.js lo muestra', () => {
    const samples = [
      [0, 0],
      [0.25, 0.1],
      [0.9, 0.75],
      [1, 1]
    ]
    pdfLibDoc.getPages().forEach((page, i) => {
      const frame = pageFrame(page)
      const [a, b, c, d, e, f] = frame.matrix
      for (const [u, v] of samples) {
        // Punto del overlay (0..1, origen arriba) → marco (origen abajo) → espacio PDF.
        const X = u * frame.width
        const Y = frame.height - v * frame.height
        const [px, py] = viewports[i].convertToViewportPoint(a * X + c * Y + e, b * X + d * Y + f)
        expect(px).toBeCloseTo(u * viewports[i].width, 3)
        expect(py).toBeCloseTo(v * viewports[i].height, 3)
      }
    })
  })
})

describe('widgetPlacement (campos nuevos en páginas giradas)', () => {
  it('el widget de pdf-lib cae exactamente en la caja pedida, en las 4 rotaciones', async () => {
    const pdf = await PDFDocument.create()
    const form = pdf.getForm()
    const wanted = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }
    for (const rotation of [0, 90, 180, 270]) {
      const page = pdf.addPage([612, 792])
      page.setRotation(degrees(rotation))
      const frame = pageFrame(page)
      const userBox = toUserBox(frameBox(wanted, frame), frame)
      const field = form.createTextField(`campo_${rotation}`)
      field.addToPage(page, { ...widgetPlacement(userBox, frame.rotation), rotate: degrees(frame.rotation), borderWidth: 0 })
      const widget = field.acroField.getWidgets()[0]
      const rect = widget.getRectangle()
      expect(rect.x).toBeCloseTo(userBox.x, 3)
      expect(rect.y).toBeCloseTo(userBox.y, 3)
      expect(rect.width).toBeCloseTo(userBox.width, 3)
      expect(rect.height).toBeCloseTo(userBox.height, 3)
      // Y gira con la página para que su texto quede derecho en pantalla.
      const mk = widget.dict.lookup(PDFName.of('MK'))
      expect(String(mk)).toContain(`/R ${rotation}`)
    }
  })
})
