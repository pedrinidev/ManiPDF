import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { useNavigation } from '../state/navigation.context'
import { parsePageInput } from '../services/navigation-math'
import { Icon } from './Icon'

/**
 * Indicador y selector de página de la barra superior: «‹ [32] / 120 ›». Muestra
 * la página que se está viendo; al escribir un número y pulsar Enter salta a ella
 * (Esc cancela). Cmd/Ctrl+G lleva el foco al campo.
 */
export function PageNavigator(): JSX.Element | null {
  const { currentPage, pageCount, goToPage, nextPage, prevPage } = useNavigation()
  const inputRef = useRef<HTMLInputElement>(null)
  // Lo que el usuario está escribiendo; null = se muestra la página actual.
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (pageCount === 0) return null

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const target = draft === null ? null : parsePageInput(draft, pageCount)
      if (target !== null) goToPage(target)
      setDraft(null)
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      setDraft(null)
      e.currentTarget.blur()
    }
  }

  return (
    <div className="page-nav">
      <button
        className="btn icon"
        onClick={prevPage}
        disabled={currentPage <= 1}
        title="Página anterior"
        aria-label="Página anterior"
      >
        <Icon name="chevron-up" size={15} />
      </button>
      <input
        ref={inputRef}
        className="page-nav-input"
        inputMode="numeric"
        aria-label="Número de página"
        title="Ir a página (Cmd/Ctrl+G)"
        value={draft ?? String(currentPage)}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onMouseDown={(e) => {
          // Primer clic: seleccionar el número entero para escribir el nuevo
          // directamente. Si el navegador dejara el cursor al final, al escribir
          // «32» con la página 1 en pantalla saldría «132».
          if (document.activeElement !== e.currentTarget) {
            e.preventDefault()
            e.currentTarget.focus()
            e.currentTarget.select()
          }
        }}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
        onBlur={() => setDraft(null)}
      />
      <span className="page-nav-total">/ {pageCount}</span>
      <button
        className="btn icon"
        onClick={nextPage}
        disabled={currentPage >= pageCount}
        title="Página siguiente"
        aria-label="Página siguiente"
      >
        <Icon name="chevron-down" size={15} />
      </button>
    </div>
  )
}
