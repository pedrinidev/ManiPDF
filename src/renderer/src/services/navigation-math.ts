/**
 * Lógica pura de navegación entre páginas (sin DOM ni React): testeable en
 * aislamiento. El acceso al DOM vive en `navigate.ts` y el estado en
 * `state/navigation.context.tsx`.
 */

/** Limita un número de página al rango 1..pageCount. */
export function clampPage(page: number, pageCount: number): number {
  if (pageCount < 1) return 1
  return Math.min(pageCount, Math.max(1, Math.round(page)))
}

/**
 * Interpreta lo escrito en el campo «ir a página». Devuelve la página destino
 * (ajustada al rango del documento) o null si no es un número entero positivo.
 */
export function parsePageInput(text: string, pageCount: number): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return clampPage(Number(trimmed), pageCount)
}

/** Extensión vertical de una página (px, en coordenadas de pantalla). */
export interface PageSpan {
  top: number
  bottom: number
}

/**
 * Índice (0-based) de la página que está en la línea de referencia `probeY`: la
 * primera cuyo borde inferior queda por debajo de esa línea (la que la contiene o,
 * si cae en el hueco entre páginas, la siguiente). Las páginas van ordenadas de
 * arriba abajo, así que basta una búsqueda binaria (O(log n) lecturas de posición).
 */
export function pageIndexAt(
  count: number,
  spanAt: (index: number) => PageSpan,
  probeY: number
): number {
  if (count <= 0) return 0
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spanAt(mid).bottom <= probeY) lo = mid + 1
    else hi = mid
  }
  return lo
}
