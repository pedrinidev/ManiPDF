import { Buffer } from 'node:buffer'
import type { PageSizeGroup } from '@shared/ipc-contract'

/**
 * Helpers PUROS para los metadatos del documento (versión, cifrado, color, tamaños
 * de página). Sin dependencias de Electron/pdf-lib → fáciles de testear.
 */

/** Lee la versión del encabezado "%PDF-1.x" en los primeros bytes. */
export function detectPdfVersion(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 16)).toString('latin1')
  const m = head.match(/%PDF-(\d+\.\d+)/)
  return m ? m[1] : null
}

/** Recuento de marcadores de espacio de color en el archivo. */
export interface ColorMarkers {
  cmyk: number
  rgb: number
  gray: number
}

const SCAN_CHUNK = 8 * 1024 * 1024
/** Solape entre trozos: un marcador partido entre dos trozos se cuenta una vez. */
const SCAN_OVERLAP = 64

const MARKERS: Record<keyof ColorMarkers, RegExp> = {
  cmyk: /DeviceCMYK|\/N\s+4\b/g,
  rgb: /DeviceRGB|CalRGB|\/N\s+3\b/g,
  gray: /DeviceGray|CalGray|\/N\s+1\b/g
}

/**
 * Cuenta los marcadores de espacio de color (heurística: no abre los flujos
 * comprimidos). Recorre el archivo por trozos: antes lo convertía entero en una
 * cadena, que con más de 512 MB supera el límite de V8 y fallaba.
 */
export function countColorMarkers(bytes: Uint8Array, chunkSize = SCAN_CHUNK): ColorMarkers {
  const counts: ColorMarkers = { cmyk: 0, rgb: 0, gray: 0 }
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const own = Math.min(chunkSize, bytes.length - start) // lo que pertenece a este trozo
    const length = Math.min(own + SCAN_OVERLAP, bytes.length - start)
    const text = Buffer.from(bytes.buffer, bytes.byteOffset + start, length).toString('latin1')
    for (const key of Object.keys(MARKERS) as (keyof ColorMarkers)[]) {
      for (const match of text.matchAll(MARKERS[key])) if ((match.index ?? 0) < own) counts[key]++
    }
  }
  return counts
}

/**
 * Etiqueta heurística del espacio de color, contando los operadores de color del
 * contenido. Es aproximado (no abre cada flujo), suficiente para informar.
 */
export function detectColorLabel(bytes: Uint8Array): string {
  const { cmyk, rgb, gray } = countColorMarkers(bytes)
  if (cmyk > 0 && rgb > 0) return 'Color (RGB + CMYK)'
  if (cmyk > 0) return 'Color (CMYK)'
  if (rgb > 0) return 'Color (RGB)'
  if (gray > 0) return 'Escala de grises'
  return 'No determinado'
}

/** Nombres de tamaños de papel conocidos, en puntos PDF (orientación vertical). */
const KNOWN_SIZES: { name: string; w: number; h: number }[] = [
  { name: 'Carta', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'Tabloide', w: 792, h: 1224 },
  { name: 'A3', w: 841.89, h: 1190.55 },
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A5', w: 419.53, h: 595.28 }
]

/** Agrupa los tamaños de página iguales y los etiqueta (cm + nombre si se reconoce). */
export function groupPageSizes(sizes: { width: number; height: number }[]): PageSizeGroup[] {
  const groups = new Map<string, PageSizeGroup>()
  for (const { width, height } of sizes) {
    const w = Math.round(width * 10) / 10
    const h = Math.round(height * 10) / 10
    const key = `${w}x${h}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      continue
    }
    groups.set(key, { widthPt: w, heightPt: h, count: 1, label: sizeLabel(w, h) })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/** "21.6 × 27.9 cm · Carta" (el nombre solo si coincide con un tamaño conocido). */
export function sizeLabel(w: number, h: number): string {
  const cm = (pt: number): string => ((pt / 72) * 2.54).toFixed(1)
  const tol = 4 // puntos de tolerancia (≈1.4 mm)
  const match = KNOWN_SIZES.find(
    (s) =>
      (Math.abs(w - s.w) < tol && Math.abs(h - s.h) < tol) ||
      (Math.abs(w - s.h) < tol && Math.abs(h - s.w) < tol)
  )
  const base = `${cm(w)} × ${cm(h)} cm`
  return match ? `${base} · ${match.name}` : base
}
