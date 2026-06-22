import type { JSX } from 'react'
import { useSearch } from '../state/search.context'

/**
 * Overlay de solo lectura que marca las coincidencias con un resaltado azul
 * translúcido SOBRE el texto original (sin reemplazarlo, así no cambia la letra
 * ni su tamaño). La coincidencia activa va más marcada. No captura el ratón.
 */
export function SearchHighlightLayer({ pageNumber }: { pageNumber: number }): JSX.Element | null {
  const { matches, current } = useSearch()
  if (matches.length === 0) return null

  const pageMatches = matches
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => m.page === pageNumber)
  if (pageMatches.length === 0) return null

  return (
    <div className="search-layer">
      {pageMatches.map(({ m, index }) => (
        <span
          key={index}
          className={`search-hit${index === current ? ' current' : ''}`}
          style={{
            left: `${m.rect.x * 100}%`,
            top: `${m.rect.y * 100}%`,
            width: `${m.rect.w * 100}%`,
            height: `${m.rect.h * 100}%`
          }}
        />
      ))}
    </div>
  )
}
