import * as pdfjs from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// Vite resuelve esto a una URL del worker empaquetado.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Servicio de renderizado del renderer. Aísla pdf.js del resto de la UI:
 * los componentes piden "renderiza esta página en este canvas", sin tocar pdf.js.
 */

/**
 * Carga un documento pdf.js a partir de los bytes del PDF. Acepta `Uint8Array`
 * (flujo del documento, sin base64) o una cadena base64 (p. ej. el PDF a comparar).
 */
export async function loadPdf(data: Uint8Array | string, password?: string): Promise<PDFDocumentProxy> {
  const bytes = typeof data === 'string' ? base64ToBytes(data) : data
  // Copia: pdf.js puede transferir/neutralizar el buffer que recibe, y estos bytes
  // se comparten con el store/historial; no debemos dejar que los neutralice.
  return pdfjs.getDocument({ data: bytes.slice(), password }).promise
}

/** ¿El error de pdf.js es por falta o incorrección de contraseña? */
export function isPasswordError(err: unknown): 'need' | 'wrong' | null {
  const name = (err as { name?: string } | null)?.name
  if (name !== 'PasswordException') return null
  // code 1 = NEED_PASSWORD, code 2 = INCORRECT_PASSWORD (pdf.js).
  return (err as { code?: number }).code === 2 ? 'wrong' : 'need'
}

/** Renderiza una página concreta en un canvas al nivel de zoom dado. */
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  zoom: number
): Promise<void> {
  const page = await pdf.getPage(pageNumber)
  // Escala con devicePixelRatio para nitidez en pantallas HiDPI.
  const dpr = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: zoom * dpr })

  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')

  canvas.width = viewport.width
  canvas.height = viewport.height
  // Tamaño visual (CSS) sin el factor dpr, para que el zoom sea correcto.
  canvas.style.width = `${viewport.width / dpr}px`
  canvas.style.height = `${viewport.height / dpr}px`

  await page.render({ canvasContext: context, viewport }).promise
}

/**
 * Renderiza la capa de texto seleccionable de pdf.js sobre una página, alineada
 * con el canvas al nivel de zoom dado. Permite seleccionar y copiar texto.
 */
export async function renderTextLayer(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  container: HTMLElement,
  zoom: number
): Promise<void> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: zoom })
  container.replaceChildren()
  container.style.setProperty('--scale-factor', String(zoom))
  const layer = new TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport
  })
  await layer.render()
}

/** Renderiza una miniatura de la página ajustada a un ancho fijo (en px CSS). */
export async function renderThumbnail(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number
): Promise<void> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = targetWidth / base.width
  const dpr = window.devicePixelRatio || 1
  const viewport = page.getViewport({ scale: scale * dpr })

  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')

  canvas.width = viewport.width
  canvas.height = viewport.height
  canvas.style.width = `${targetWidth}px`
  canvas.style.height = `${viewport.height / dpr}px`

  await page.render({ canvasContext: context, viewport }).promise
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
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')
  // Fondo blanco: el JPEG no tiene transparencia.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return {
    jpegBase64: dataUrl.split(',')[1] ?? '',
    widthPt: base.width,
    heightPt: base.height
  }
}

/**
 * Rasteriza una página y devuelve su imagen en base64 (sin prefijo data:),
 * en PNG o JPG. Usado por el módulo convert (PDF -> imágenes).
 */
export async function renderPageToImage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  format: 'png' | 'jpg',
  quality = 0.9
): Promise<string> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')
  if (format === 'jpg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  await page.render({ canvasContext: context, viewport }).promise

  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const dataUrl = canvas.toDataURL(mime, quality)
  return dataUrl.split(',')[1] ?? ''
}

/**
 * Rasteriza una página para OCR: JPEG en base64 + dimensiones en píxeles de la
 * imagen y en puntos PDF (necesarias para colocar la capa de texto invisible).
 */
export async function renderPageForOcr(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<{
  jpegBase64: string
  widthPt: number
  heightPt: number
  imgWidthPx: number
  imgHeightPx: number
}> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise

  return {
    jpegBase64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '',
    widthPt: base.width,
    heightPt: base.height,
    imgWidthPx: canvas.width,
    imgHeightPx: canvas.height
  }
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
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo obtener el contexto 2D del canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: context, viewport }).promise

  context.fillStyle = '#000000'
  for (const r of rects) {
    context.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height)
  }

  return {
    jpegBase64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '',
    widthPt: base.width,
    heightPt: base.height
  }
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
