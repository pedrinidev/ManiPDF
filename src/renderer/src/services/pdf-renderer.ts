import * as pdfjs from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { OcrInputPage } from '@shared/ipc-contract'
// Vite resuelve esto a una URL del worker empaquetado.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { keepImagesSmooth } from './canvas-smoothing'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Servicio de renderizado del renderer. Aísla pdf.js del resto de la UI:
 * los componentes piden "renderiza esta página en este canvas", sin tocar pdf.js.
 */

/** Tamaño de una página en puntos tal como se ve (CropBox y rotación aplicados). */
export interface PageSize {
  width: number
  height: number
}

/**
 * Un render en curso que se puede cancelar (al cambiar de zoom o de documento, o
 * al desmontar la página). Si se cancela, `promise` se rechaza con un error que
 * `isRenderCancelled` reconoce.
 */
export interface CancellableRender {
  promise: Promise<void>
  cancel: () => void
}

class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelado')
    this.name = 'RenderCancelledError'
  }
}

/** ¿El error viene de cancelar un render (propio o de pdf.js)? No es un fallo real. */
export function isRenderCancelled(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name
  return (
    name === 'RenderCancelledError' ||
    name === 'RenderingCancelledException' ||
    name === 'AbortException'
  )
}

interface CanvasAndContext {
  canvas: HTMLCanvasElement | null
  context: CanvasRenderingContext2D | null
}

/**
 * Factoría de lienzos auxiliares de pdf.js (grupos de transparencia, máscaras,
 * patrones…), igual que la suya por defecto pero con el suavizado de imágenes fijo.
 */
class SmoothCanvasFactory {
  private readonly willReadFrequently: boolean

  constructor({ enableHWA = false }: { enableHWA?: boolean } = {}) {
    this.willReadFrequently = !enableHWA
  }

  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: this.willReadFrequently })
    if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')
    keepImagesSmooth(context)
    return { canvas, context }
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified')
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size')
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
    // Redimensionar un canvas restablece su estado (calidad de suavizado incluida).
    if (canvasAndContext.context) keepImagesSmooth(canvasAndContext.context)
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    if (!canvasAndContext.canvas) throw new Error('Canvas is not specified')
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
    canvasAndContext.canvas = null
    canvasAndContext.context = null
  }
}

/** Contexto 2D de un canvas ya dimensionado, con el suavizado de imágenes fijo. */
function smoothContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')
  keepImagesSmooth(context)
  return context
}

/**
 * Carga un documento pdf.js a partir de los bytes del PDF. Acepta `Uint8Array`
 * (flujo del documento, sin base64) o una cadena base64 (p. ej. el PDF a comparar).
 */
export async function loadPdf(data: Uint8Array | string, password?: string): Promise<PDFDocumentProxy> {
  const bytes = typeof data === 'string' ? base64ToBytes(data) : data
  // Copia: pdf.js puede transferir/neutralizar el buffer que recibe, y estos bytes
  // se comparten con el store/historial; no debemos dejar que los neutralice.
  return pdfjs.getDocument({ data: bytes.slice(), password, CanvasFactory: SmoothCanvasFactory })
    .promise
}

/**
 * Tamaño (en puntos, a escala 1) de todas las páginas, tal como se ven. Con él el
 * visor reserva el hueco exacto de cada página antes de pintarla: el zoom conserva
 * la posición, "ir a página" es exacto y las páginas fuera de vista no descuadran.
 */
export async function getPageSizes(pdf: PDFDocumentProxy): Promise<PageSize[]> {
  const sizes: (PageSize | null)[] = new Array(pdf.numPages).fill(null)
  const BATCH = 64
  for (let first = 1; first <= pdf.numPages; first += BATCH) {
    const last = Math.min(pdf.numPages, first + BATCH - 1)
    const numbers = Array.from({ length: last - first + 1 }, (_, i) => first + i)
    // Una página dañada no debe impedir mostrar el resto: se le asigna un tamaño
    // de reserva (el de la página anterior, o Carta) y se pinta como pueda.
    const pages = await Promise.all(numbers.map((n) => pdf.getPage(n).catch(() => null)))
    pages.forEach((page, i) => {
      if (!page) return
      const { width, height } = page.getViewport({ scale: 1 })
      sizes[first - 1 + i] = { width, height }
    })
  }
  let fallback: PageSize = { width: 612, height: 792 }
  return sizes.map((size) => (size ? (fallback = size) : fallback))
}

/** ¿El error de pdf.js es por falta o incorrección de contraseña? */
export function isPasswordError(err: unknown): 'need' | 'wrong' | null {
  const name = (err as { name?: string } | null)?.name
  if (name !== 'PasswordException') return null
  // code 1 = NEED_PASSWORD, code 2 = INCORRECT_PASSWORD (pdf.js).
  return (err as { code?: number }).code === 2 ? 'wrong' : 'need'
}

/**
 * Renderiza una página en el canvas visible al nivel de zoom dado (con la
 * densidad de la pantalla, para nitidez en HiDPI). El tamaño CSS del canvas lo
 * fija quien lo muestra.
 *
 * Se pinta en un lienzo aparte y se vuelca al visible solo al terminar: mientras
 * tanto la página sigue mostrando el render anterior, sin quedarse en blanco. Si
 * llega otro zoom antes de acabar, `cancel()` detiene este render; antes, dos
 * renders sobre el mismo canvas se pisaban y la página quedaba vacía o deformada.
 */
export function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  zoom: number
): CancellableRender {
  let cancelled = false
  let task: RenderTask | null = null
  const promise = (async () => {
    const page = await pdf.getPage(pageNumber)
    if (cancelled) throw new RenderCancelledError()
    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: zoom * dpr })

    const work = document.createElement('canvas')
    work.width = Math.ceil(viewport.width)
    work.height = Math.ceil(viewport.height)
    try {
      task = page.render({ canvasContext: smoothContext(work), viewport })
      await task.promise
      if (cancelled) throw new RenderCancelledError()
      canvas.width = work.width
      canvas.height = work.height
      canvas.getContext('2d')?.drawImage(work, 0, 0)
    } finally {
      // Libera la memoria del lienzo de trabajo (en zooms altos son cientos de MB).
      work.width = 0
      work.height = 0
    }
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
      task?.cancel()
    }
  }
}

/**
 * Renderiza la capa de texto seleccionable de pdf.js sobre una página, alineada
 * con el canvas al nivel de zoom dado. Permite seleccionar y copiar texto.
 */
export function renderTextLayer(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  zoom: number
): CancellableRender {
  let cancelled = false
  let layer: TextLayer | null = null
  const promise = (async () => {
    const page = await pdf.getPage(pageNumber)
    if (cancelled) throw new RenderCancelledError()
    const viewport = page.getViewport({ scale: zoom })
    container.replaceChildren()
    container.style.setProperty('--scale-factor', String(zoom))
    layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport
    })
    await layer.render()
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
      layer?.cancel()
    }
  }
}

/** Renderiza una miniatura de la página ajustada a un ancho fijo (en px CSS). */
export function renderThumbnail(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number
): CancellableRender {
  let cancelled = false
  let task: RenderTask | null = null
  const promise = (async () => {
    const page = await pdf.getPage(pageNumber)
    if (cancelled) throw new RenderCancelledError()
    const base = page.getViewport({ scale: 1 })
    const scale = targetWidth / base.width
    const dpr = window.devicePixelRatio || 1
    const viewport = page.getViewport({ scale: scale * dpr })

    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    canvas.style.width = `${targetWidth}px`
    canvas.style.height = `${viewport.height / dpr}px`

    task = page.render({ canvasContext: smoothContext(canvas), viewport })
    await task.promise
  })()
  return {
    promise,
    cancel: () => {
      cancelled = true
      task?.cancel()
    }
  }
}

/**
 * Rasteriza una página a JPEG (base64, sin prefijo) para el módulo optimize.
 * `scale` controla la resolución (1 = 72 DPI) y `quality` la compresión JPEG.
 * Devuelve también las dimensiones de la página en puntos PDF.
 */
export async function renderPageToJpeg(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  quality: number
): Promise<{ jpegBase64: string; widthPt: number; heightPt: number }> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 }) // dimensiones en puntos
  const jpegBase64 = await rasterizeToJpeg(page, scale, quality)
  return { jpegBase64, widthPt: base.width, heightPt: base.height }
}

/** Lado y área máximos de canvas fiables en Chromium: por encima, la imagen sale vacía. */
const MAX_CANVAS_SIDE = 16384
const MAX_CANVAS_AREA = (16384 * 16384) / 2

/** La escala pedida, reducida lo justo para que el canvas no supere esos límites. */
function usableScale(base: PageSize, scale: number): number {
  return Math.min(
    scale,
    MAX_CANVAS_SIDE / base.width,
    MAX_CANVAS_SIDE / base.height,
    Math.sqrt(MAX_CANVAS_AREA / (base.width * base.height))
  )
}

/**
 * Pinta la página (tal como se ve) sobre fondo blanco y la devuelve en JPEG
 * (base64, sin prefijo). Libera el canvas al terminar: a escala 2, cada página
 * son decenas de MB que, si no, esperarían al recolector de basura.
 */
async function rasterizeToJpeg(
  page: PDFPageProxy,
  scale: number,
  quality: number,
  paint?: (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void
): Promise<string> {
  const viewport = page.getViewport({ scale: usableScale(page.getViewport({ scale: 1 }), scale) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  try {
    const context = smoothContext(canvas)
    // Fondo blanco: el JPEG no tiene transparencia.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    paint?.(context, canvas)
    const jpegBase64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? ''
    if (!jpegBase64) throw new Error(`No se pudo generar la imagen de la página ${page.pageNumber}`)
    return jpegBase64
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Rasteriza una página a PNG o JPG y devuelve sus bytes (sin base64). Usado por la
 * exportación a imágenes, página a página. Si a la resolución pedida la página
 * superaría el tamaño máximo de un canvas (p. ej. un A0 a 600 ppp), se reduce lo
 * justo (`reduced`): antes salía una imagen vacía sin aviso.
 */
export async function renderPageToImageBytes(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  format: 'png' | 'jpg',
  quality = 0.9
): Promise<{ bytes: Uint8Array; reduced: boolean }> {
  const page = await pdf.getPage(pageNumber)
  const usable = usableScale(page.getViewport({ scale: 1 }), scale)
  const viewport = page.getViewport({ scale: usable })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  try {
    const context = smoothContext(canvas)
    if (format === 'jpg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    await page.render({ canvasContext: context, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, format === 'jpg' ? 'image/jpeg' : 'image/png', quality)
    )
    if (!blob || blob.size === 0) throw new Error(`No se pudo generar la imagen de la página ${pageNumber}`)
    return { bytes: new Uint8Array(await blob.arrayBuffer()), reduced: usable < scale }
  } finally {
    // Libera la memoria del canvas enseguida (a 600 ppp son cientos de MB).
    canvas.width = 0
    canvas.height = 0
  }
}

/**
 * Rasteriza una página para OCR, tal como se ve (CropBox y rotación aplicados):
 * JPEG en base64 + tamaño de la imagen en píxeles, con el que el proceso principal
 * coloca la capa de texto invisible sobre la página.
 */
export async function renderPageForOcr(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<OcrInputPage> {
  const page = await pdf.getPage(pageNumber)
  let imgWidthPx = 0
  let imgHeightPx = 0
  const jpegBase64 = await rasterizeToJpeg(page, scale, 0.85, (_context, canvas) => {
    imgWidthPx = canvas.width
    imgHeightPx = canvas.height
  })
  return { pageNumber, jpegBase64, imgWidthPx, imgHeightPx }
}

/** Menos caracteres que esto sobre una imagen = página escaneada con un sello o un número. */
const FEW_TEXT_CHARS = 50

/** Operadores de pdf.js que pintan imágenes (también máscaras: escaneos en blanco y negro). */
const IMAGE_OPS = new Set<number>([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintInlineImageXObjectGroup,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageMaskXObjectGroup,
  pdfjs.OPS.paintImageMaskXObjectRepeat,
  pdfjs.OPS.paintSolidColorImageMask
])

/**
 * Páginas (1-based) que necesitan OCR para ser buscables: las que no tienen texto
 * y las escaneadas que solo llevan unos pocos caracteres encima (un sello, un
 * número de página). Las demás ya son buscables y no se tocan.
 */
export async function pagesNeedingOcr(pdf: PDFDocumentProxy): Promise<number[]> {
  const result: number[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    let chars = 0
    for (const item of content.items) {
      if ('str' in item) chars += item.str.replace(/\s+/g, '').length
    }
    if (chars === 0 || (chars < FEW_TEXT_CHARS && (await paintsImages(page)))) result.push(n)
  }
  return result
}

async function paintsImages(page: PDFPageProxy): Promise<boolean> {
  const { fnArray } = await page.getOperatorList()
  return fnArray.some((fn) => IMAGE_OPS.has(fn))
}

/**
 * Rasteriza una página y QUEMA recuadros negros sobre ella (redacción). Como el
 * resultado es una imagen, el contenido bajo los recuadros desaparece de verdad.
 * `rects` son normalizados (0..1, origen arriba).
 */
export async function renderPageRedacted(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  rects: { x: number; y: number; w: number; h: number }[]
): Promise<{ jpegBase64: string; widthPt: number; heightPt: number }> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const jpegBase64 = await rasterizeToJpeg(page, scale, 0.85, (context, canvas) => {
    context.fillStyle = '#000000'
    for (const r of rects) {
      context.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height)
    }
  })
  return { jpegBase64, widthPt: base.width, heightPt: base.height }
}

/** Extrae las líneas de texto de una página (usa los saltos de línea de pdf.js). */
export async function extractPageLines(
  pdf: PDFDocumentProxy,
  pageNumber: number
): Promise<string[]> {
  const page = await pdf.getPage(pageNumber)
  const content = await page.getTextContent()
  const lines: string[] = []
  let current = ''
  for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
    if (item.str === undefined) continue
    current += item.str
    if (item.hasEOL) {
      const trimmed = current.trim()
      if (trimmed) lines.push(trimmed)
      current = ''
    }
  }
  const last = current.trim()
  if (last) lines.push(last)
  return lines
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
