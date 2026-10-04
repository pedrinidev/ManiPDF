import {
  PDFPage,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState
} from 'pdf-lib'
import type { RectArea } from '@shared/ipc-contract'

/**
 * Geometría de la página TAL COMO SE VE (lógica pura sobre pdf-lib).
 *
 * El visor (pdf.js) muestra la zona CropBox ∩ MediaBox girada según /Rotate, y las
 * coordenadas del overlay son relativas a eso. Antes se convertían con el tamaño
 * de la MediaBox sin girar: en una página girada o recortada lo grabado aparecía
 * en otro sitio (y girado), o fuera de la zona visible.
 *
 * Un «marco» describe la página visible con origen abajo-izquierda e y hacia
 * arriba (como una página normal) y la matriz que lo lleva al espacio PDF.
 */
export interface PageFrame {
  /** Ancho y alto de la página tal como se ve, en puntos. */
  width: number
  height: number
  /** Giro de la página (/Rotate normalizado), en grados. */
  rotation: 0 | 90 | 180 | 270
  /** Matriz [a b c d e f] del marco visible al espacio de usuario del PDF. */
  matrix: [number, number, number, number, number, number]
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export function pageFrame(page: PDFPage): PageFrame {
  const { x0, y0, x1, y1 } = visibleBox(page)
  const w = x1 - x0
  const h = y1 - y0
  const rotation = normalizeRotation(page.getRotation().angle)
  switch (rotation) {
    case 90:
      return { width: h, height: w, rotation, matrix: [0, 1, -1, 0, x1, y0] }
    case 180:
      return { width: w, height: h, rotation, matrix: [-1, 0, 0, -1, x1, y1] }
    case 270:
      return { width: h, height: w, rotation, matrix: [0, -1, 1, 0, x0, y1] }
    default:
      return { width: w, height: h, rotation, matrix: [1, 0, 0, 1, x0, y0] }
  }
}

/**
 * Dibuja en el marco visible: todo lo que haga `draw` (con coordenadas del marco)
 * queda colocado y orientado como se ve en pantalla.
 */
export function drawInFrame(page: PDFPage, frame: PageFrame, draw: () => void): void {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...frame.matrix))
  try {
    draw()
  } finally {
    page.pushOperators(popGraphicsState())
  }
}

/** Rectángulo normalizado del overlay (0..1, origen arriba) en coordenadas del marco. */
export function frameBox(rect: RectArea, frame: PageFrame): Box {
  return {
    x: rect.x * frame.width,
    y: frame.height - (rect.y + rect.h) * frame.height,
    width: rect.w * frame.width,
    height: rect.h * frame.height
  }
}

/** Caja del marco llevada al espacio PDF (su envolvente, alineada a los ejes). */
export function toUserBox(box: Box, frame: PageFrame): Box {
  const [a, b, c, d, e, f] = frame.matrix
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height]
  ].map(([X, Y]) => [a * X + c * Y + e, b * X + d * Y + f])
  const xs = corners.map((p) => p[0])
  const ys = corners.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/**
 * Opciones de posición para `campo.addToPage()` de pdf-lib que dejan el widget en
 * `userBox` y con el texto derecho en pantalla. En una página girada el widget
 * lleva la misma rotación (/MK /R) y pdf-lib espera el rectángulo «sin girar».
 */
export function widgetPlacement(userBox: Box, rotation: PageFrame['rotation']): Box {
  const { x, y, width: bw, height: bh } = userBox
  switch (rotation) {
    case 90:
      return { x: x + bw, y, width: bh, height: bw }
    case 180:
      return { x: x + bw, y: y + bh, width: bw, height: bh }
    case 270:
      return { x, y: y + bh, width: bh, height: bw }
    default:
      return userBox
  }
}

/** Zona visible de la página (CropBox ∩ MediaBox), como hace pdf.js. */
function visibleBox(page: PDFPage): { x0: number; y0: number; x1: number; y1: number } {
  const media = page.getMediaBox()
  const crop = page.getCropBox()
  const x0 = Math.max(media.x, crop.x)
  const y0 = Math.max(media.y, crop.y)
  const x1 = Math.min(media.x + media.width, crop.x + crop.width)
  const y1 = Math.min(media.y + media.height, crop.y + crop.height)
  if (x1 - x0 > 0 && y1 - y0 > 0) return { x0, y0, x1, y1 }
  return { x0: media.x, y0: media.y, x1: media.x + media.width, y1: media.y + media.height }
}

function normalizeRotation(angle: number): PageFrame['rotation'] {
  const r = (((Math.round(angle / 90) * 90) % 360) + 360) % 360
  return r as PageFrame['rotation']
}
