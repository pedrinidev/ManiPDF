/** Desplaza el visor hasta una página (1-based). */
export function goToPage(pageNumber: number): void {
  const el = document.querySelector(`.page-wrapper[data-page="${pageNumber}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Abre una URL externa en el navegador del sistema (filtra esquemas inseguros). */
export function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank')
}
