import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react'
import { useSearch } from '../state/search.context'
import { Icon } from './Icon'

/** Campo de búsqueda compacto, fijo en la barra superior (junto a imprimir). */
export function SearchBar(): JSX.Element {
  const { query, matches, current, searching, reveal, setQuery, next, prev, clear } = useSearch()
  const inputRef = useRef<HTMLInputElement>(null)

  // Cmd/Ctrl+F enfoca el campo (sin desplazar la app).
  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        inputRef.current?.focus({ preventScroll: true })
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Lleva la coincidencia pedida a la vista desplazando SOLO el documento
  // (nunca la app, para que el menú no se mueva).
  useEffect(() => {
    if (!reveal) return
    const m = reveal.match
    const container = document.querySelector('.content') as HTMLElement | null
    const page = document.querySelector(`.page-wrapper[data-page="${m.page}"]`) as HTMLElement | null
    if (!container || !page || m.rects.length === 0) return
    const cRect = container.getBoundingClientRect()
    const pRect = page.getBoundingClientRect()
    // Posición del match dentro del contenido desplazable (también en horizontal,
    // por si con zoom la coincidencia queda fuera por un lado).
    const top = Math.min(...m.rects.map((r) => r.y))
    const left = Math.min(...m.rects.map((r) => r.x))
    const matchTop = pRect.top - cRect.top + container.scrollTop + top * pRect.height
    const matchLeft = pRect.left - cRect.left + container.scrollLeft + left * pRect.width
    const outOfView = matchLeft < container.scrollLeft || matchLeft > container.scrollLeft + container.clientWidth - 40
    container.scrollTo({
      top: matchTop - container.clientHeight / 2,
      left: outOfView ? matchLeft - container.clientWidth / 3 : container.scrollLeft,
      behavior: 'smooth'
    })
  }, [reveal])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') (e.shiftKey ? prev : next)()
    if (e.key === 'Escape') clear()
  }

  const count =
    matches.length === 0
      ? searching
        ? '…'
        : query.trim().length >= 2
          ? '0'
          : ''
      : `${current + 1}/${matches.length}`

  return (
    <div className="search-field">
      <span className="search-field-icon">
        <Icon name="search" size={14} />
      </span>
      <input
        ref={inputRef}
        type="text"
        placeholder="Buscar… (Cmd/Ctrl+F)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {count && <span className="search-count">{count}</span>}
      <button className="btn icon" onClick={prev} disabled={matches.length === 0} title="Anterior (Shift+Enter)">
        <Icon name="chevron-up" size={15} />
      </button>
      <button className="btn icon" onClick={next} disabled={matches.length === 0} title="Siguiente (Enter)">
        <Icon name="chevron-down" size={15} />
      </button>
      {query && (
        <button className="btn icon" onClick={clear} title="Limpiar (Esc)">
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  )
}
