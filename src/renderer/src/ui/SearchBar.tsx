import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react'
import { useSearch } from '../state/search.context'
import { Icon } from './Icon'

/** Campo de búsqueda compacto, fijo en la barra superior (junto a imprimir). */
export function SearchBar(): JSX.Element {
  const { query, matches, current, searching, setQuery, next, prev, clear } = useSearch()
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

  // Lleva la coincidencia activa a la vista desplazando SOLO el documento
  // (nunca la app, para que el menú no se mueva).
  useEffect(() => {
    if (current < 0 || !matches[current]) return
    const m = matches[current]
    const container = document.querySelector('.content') as HTMLElement | null
    const page = document.querySelector(`.page-wrapper[data-page="${m.page}"]`) as HTMLElement | null
    if (!container || !page) return
    const cRect = container.getBoundingClientRect()
    const pRect = page.getBoundingClientRect()
    // Posición del match dentro del contenido desplazable.
    const matchTop = pRect.top - cRect.top + container.scrollTop + m.rect.y * pRect.height
    container.scrollTo({ top: matchTop - container.clientHeight / 2, behavior: 'smooth' })
  }, [current, matches])

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
