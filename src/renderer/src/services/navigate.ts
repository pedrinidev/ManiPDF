/**
 * Acciones de navegación sobre el DOM del visor. Desplazan SOLO el contenedor
 * indicado: `scrollIntoView` también desplaza los contenedores padres (aunque
 * tengan `overflow: hidden`) y movía la interfaz completa.
 */

/** Margen por encima de la página al saltar a ella (px): deja ver su borde. */
export const PAGE_SCROLL_MARGIN = 12

/**
 * Línea de referencia de la «página actual», medida desde el borde superior del
 * área visible (px). Tras saltar a una página (margen 12) cae dentro de ella.
 */
export const CURRENT_PAGE_PROBE = 24

/** Contenedor DOM de una página del visor (1-based), o null si no existe. */
export function pageWrapper(container: HTMLElement, pageNumber: number): HTMLElement | null {
  return container.querySelector<HTMLElement>(`.page-wrapper[data-page="${pageNumber}"]`)
}

/** Desplaza el área del documento hasta la página indicada (1-based). */
export function scrollToPage(container: HTMLElement, pageNumber: number): boolean {
  const wrapper = pageWrapper(container, pageNumber)
  if (!wrapper) return false
  const delta =
    wrapper.getBoundingClientRect().top - container.getBoundingClientRect().top - PAGE_SCROLL_MARGIN
  container.scrollTop += delta
  return true
}

/** Hace visible un elemento dentro de su lista desplazable, moviendo solo esa lista. */
export function scrollIntoViewWithin(container: HTMLElement, el: HTMLElement, margin = 8): void {
  const box = container.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  if (r.top < box.top + margin) container.scrollTop -= box.top + margin - r.top
  else if (r.bottom > box.bottom - margin) container.scrollTop += r.bottom - (box.bottom - margin)
}

/** Abre una URL externa en el navegador del sistema (filtra esquemas inseguros). */
export function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank')
}
