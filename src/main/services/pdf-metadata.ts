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

/** Heurística: el documento está cifrado si su trailer referencia /Encrypt. */
export function detectEncrypted(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).toString('latin1').includes('/Encrypt')
}

/**
 * Etiqueta heurística del espacio de color, contando los operadores de color del
 * contenido. Es aproximado (no abre cada flujo), suficiente para informar.
 */
export function detectColorLabel(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('latin1')
  const cmyk = (text.match(/DeviceCMYK/g) || []).length + (text.match(/\/N\s+4\b/g) || []).length
  const rgb =
    (text.match(/DeviceRGB|CalRGB/g) || []).length + (text.match(/\/N\s+3\b/g) || []).length
  const gray = (text.match(/DeviceGray|CalGray/g) || []).length + (text.match(/\/N\s+1\b/g) || []).length
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
