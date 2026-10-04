import type { RectArea } from '@shared/ipc-contract'

/**
 * Búsqueda de texto en una página (lógica pura, sin pdf.js ni DOM).
 *
 * El texto de pdf.js llega en fragmentos: una frase puede estar repartida en
 * varios (cambios de fuente, espacios, saltos de línea). Antes se buscaba dentro
 * de cada fragmento por separado, así que «Hola mundo» no aparecía si estaba
 * partido, y las cajas se calculaban sin la matriz de la página: en páginas
 * giradas o recortadas el resaltado salía en otro sitio.
 */

/** Lo que la búsqueda necesita de un fragmento de texto de pdf.js. */
export interface SearchTextItem {
  str: string
  /** Matriz [a b c d e f] del fragmento al espacio de la página (`transform` de pdf.js). */
  transform: number[]
  /** Ancho (a lo largo de la línea base) y alto del fragmento, en unidades de la página. */
  width: number
  height: number
  /** Hay un salto de línea tras el fragmento (`hasEOL` de pdf.js). */
  hasEOL: boolean
}

/** Texto de una página listo para buscar, con el origen de cada carácter. */
export interface SearchIndex {
  /** Texto normalizado: minúsculas, sin tildes y con los espacios colapsados. */
  text: string
  /** Por cada carácter de `text`: fragmento de origen (-1 = salto de línea añadido)… */
  itemOf: Int32Array
  /** …y qué caracteres de ese fragmento representa: [from, to). */
  fromOf: Int32Array
  toOf: Int32Array
}

/** Parte de una coincidencia dentro de un fragmento: caracteres [from, to) de `str`. */
export interface MatchSegment {
  item: number
  from: number
  to: number
}

const WHITESPACE = /\s/u
const COMBINING_MARKS = /\p{M}/gu

/** Un carácter tal como se compara: minúsculas y sin tildes («Á» → «a»). */
function foldChar(ch: string): string {
  return ch.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()
}

/** La consulta normalizada igual que el texto de las páginas. */
export function normalizeQuery(query: string): string {
  let out = ''
  for (const ch of query) out += WHITESPACE.test(ch) ? ' ' : foldChar(ch)
  return out.replace(/ +/g, ' ').trim()
}

export function buildSearchIndex(items: SearchTextItem[]): SearchIndex {
  const chars: string[] = []
  const itemOf: number[] = []
  const fromOf: number[] = []
  const toOf: number[] = []
  let lastWasSpace = true // sin espacios al principio ni repetidos

  const push = (ch: string, item: number, from: number, to: number): void => {
    chars.push(ch)
    itemOf.push(item)
    fromOf.push(from)
    toOf.push(to)
  }

  items.forEach((item, index) => {
    let at = 0
    for (const ch of item.str) {
      const from = at
      at += ch.length
      if (WHITESPACE.test(ch)) {
        if (!lastWasSpace) push(' ', index, from, at)
        lastWasSpace = true
        continue
      }
      const folded = foldChar(ch)
      if (folded === '') {
        // Tilde suelta (texto ya descompuesto): pertenece al carácter anterior.
        const last = itemOf.length - 1
        if (last >= 0 && itemOf[last] === index) toOf[last] = at
        continue
      }
      for (const part of folded) {
        push(part, index, from, at)
        lastWasSpace = false
      }
    }
    if (item.hasEOL && !lastWasSpace) {
      push(' ', -1, 0, 0)
      lastWasSpace = true
    }
  })

  return {
    text: chars.join(''),
    itemOf: Int32Array.from(itemOf),
    fromOf: Int32Array.from(fromOf),
    toOf: Int32Array.from(toOf)
  }
}

/**
 * Todas las apariciones de `query` (ya normalizada con `normalizeQuery`), cada una
 * como los trozos de fragmento que ocupa (varios si cruza fragmentos o líneas).
 */
export function findMatches(index: SearchIndex, query: string): MatchSegment[][] {
  const out: MatchSegment[][] = []
  if (!query) return out
  let at = index.text.indexOf(query)
  while (at !== -1) {
    const segments: MatchSegment[] = []
    for (let p = at; p < at + query.length; p++) {
      const item = index.itemOf[p]
      if (item < 0) continue
      const last = segments[segments.length - 1]
      if (last && last.item === item) {
        last.from = Math.min(last.from, index.fromOf[p])
        last.to = Math.max(last.to, index.toOf[p])
      } else {
        segments.push({ item, from: index.fromOf[p], to: index.toOf[p] })
      }
    }
    if (segments.length > 0) out.push(segments)
    at = index.text.indexOf(query, at + query.length)
  }
  return out
}

/** Geometría de la página tal como se ve (el viewport de pdf.js a escala 1). */
export interface PageGeometry {
  width: number
  height: number
  /** Punto del espacio de la página → punto en pantalla (`convertToViewportPoint`). */
  toViewport: (x: number, y: number) => number[]
}

/**
 * Caja (normalizada 0..1, origen arriba) de los caracteres [from, to) de un
 * fragmento, tal como se ve. `measure` da el ancho relativo de un texto en la
 * fuente del fragmento, para repartir su ancho entre los caracteres.
 */
export function segmentRect(
  item: SearchTextItem,
  from: number,
  to: number,
  geometry: PageGeometry,
  measure: (text: string) => number
): RectArea {
  const total = measure(item.str)
  const ratio = (n: number): number =>
    total > 0 ? measure(item.str.slice(0, n)) / total : item.str.length > 0 ? n / item.str.length : 0
  const [a, b, c, d, e, f] = item.transform
  const along = Math.hypot(a, b) || 1
  const across = Math.hypot(c, d) || 1
  const height = item.height > 0 ? item.height : across
  // Desde la línea base: un poco por debajo (descendentes) y casi un cuerpo por encima.
  const u0 = ratio(from) * item.width
  const u1 = ratio(to) * item.width
  const v0 = -0.2 * height
  const v1 = 0.9 * height

  const xs: number[] = []
  const ys: number[] = []
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) {
    const [x, y] = geometry.toViewport(e + (u * a) / along + (v * c) / across, f + (u * b) / along + (v * d) / across)
    xs.push(x)
    ys.push(y)
  }
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return {
    x: x0 / geometry.width,
    y: y0 / geometry.height,
    w: (Math.max(...xs) - x0) / geometry.width,
    h: (Math.max(...ys) - y0) / geometry.height
  }
}

/**
 * Cajas de una coincidencia: una por línea. Los trozos seguidos sobre la misma
 * línea base (fragmentos distintos de una misma frase) se unen en una sola caja;
 * antes cada fragmento llevaba la suya y se veían «costuras».
 */
export function matchRects(
  segments: MatchSegment[],
  items: SearchTextItem[],
  geometry: PageGeometry,
  measureFor: (item: number) => (text: string) => number
): RectArea[] {
  const rects: RectArea[] = []
  let previous: MatchSegment | null = null
  for (const segment of segments) {
    const rect = segmentRect(items[segment.item], segment.from, segment.to, geometry, measureFor(segment.item))
    const last = rects[rects.length - 1]
    if (previous && last && sameLine(items[previous.item], items[segment.item], last, rect, geometry)) {
      rects[rects.length - 1] = union(last, rect)
    } else {
      rects.push(rect)
    }
    previous = segment
  }
  return rects
}

/** Misma dirección, misma línea base y cerca (no dos columnas en la misma altura). */
function sameLine(
  a: SearchTextItem,
  b: SearchTextItem,
  ra: RectArea,
  rb: RectArea,
  geometry: PageGeometry
): boolean {
  const la = Math.hypot(a.transform[0], a.transform[1]) || 1
  const lb = Math.hypot(b.transform[0], b.transform[1]) || 1
  const ux = a.transform[0] / la
  const uy = a.transform[1] / la
  if (ux * (b.transform[0] / lb) + uy * (b.transform[1] / lb) < 0.99) return false
  const height = Math.max(a.height, b.height) || 1
  const offLine = Math.abs(-(b.transform[4] - a.transform[4]) * uy + (b.transform[5] - a.transform[5]) * ux)
  if (offLine > 0.5 * height) return false
  const gapX = (Math.max(ra.x, rb.x) - Math.min(ra.x + ra.w, rb.x + rb.w)) * geometry.width
  const gapY = (Math.max(ra.y, rb.y) - Math.min(ra.y + ra.h, rb.y + rb.h)) * geometry.height
  return Math.max(gapX, gapY) <= 2 * height
}

function union(a: RectArea, b: RectArea): RectArea {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
