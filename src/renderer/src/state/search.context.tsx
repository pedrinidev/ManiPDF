import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type JSX
} from 'react'
import type { RectArea } from '@shared/ipc-contract'
import { useDocument } from './document.store'
import { usePdf } from './pdf.context'

/** Una coincidencia de búsqueda: página (1-based) y caja normalizada (0..1, origen arriba). */
export interface SearchMatch {
  page: number
  rect: RectArea
}

/** Forma mínima de un item de texto de pdf.js que necesitamos. */
interface TextItemLike {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

interface SearchContextValue {
  query: string
  matches: SearchMatch[]
  current: number // índice en matches, -1 si no hay
  searching: boolean
  setQuery: (q: string) => void
  next: () => void
  prev: () => void
  clear: () => void
}

const SearchContext = createContext<SearchContextValue | null>(null)

export function SearchProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useDocument()
  const { pdf } = usePdf()

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [current, setCurrent] = useState(-1)
  const [searching, setSearching] = useState(false)

  // Al cambiar de documento, limpia resultados.
  useEffect(() => {
    setMatches([])
    setCurrent(-1)
  }, [state.doc?.id])

  // Busca (con un pequeño debounce) cada vez que cambia la consulta.
  useEffect(() => {
    if (!pdf) return
    const q = query.trim()
    if (q.length < 2) {
      setMatches([])
      setCurrent(-1)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      const found = await computeMatches(pdf, q)
      if (cancelled) return
      setMatches(found)
      setCurrent(found.length > 0 ? 0 : -1)
      setSearching(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [pdf, query])

  const clear = useCallback(() => {
    setQuery('')
    setMatches([])
    setCurrent(-1)
  }, [])

  const next = useCallback(
    () => setCurrent((c) => (matches.length === 0 ? -1 : (c + 1) % matches.length)),
    [matches.length]
  )
  const prev = useCallback(
    () =>
      setCurrent((c) => (matches.length === 0 ? -1 : (c - 1 + matches.length) % matches.length)),
    [matches.length]
  )

  const value = useMemo(
    () => ({ query, matches, current, searching, setQuery, next, prev, clear }),
    [query, matches, current, searching, next, prev, clear]
  )

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

/**
 * Recorre las páginas y devuelve las cajas SOLO de las coincidencias (no del
 * item de texto entero). Dentro de cada item, ubica cada aparición por su
 * posición de carácter y aproxima su ancho de forma proporcional.
 */
async function computeMatches(
  pdf: import('pdfjs-dist').PDFDocumentProxy,
  query: string
): Promise<SearchMatch[]> {
  const needle = query.toLowerCase()
  const out: SearchMatch[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    for (const raw of content.items as TextItemLike[]) {
      const str = raw.str
      const tx = raw.transform
      if (!str || !tx) continue
      const lower = str.toLowerCase()
      if (!lower.includes(needle)) continue

      const x = tx[4]
      const y = tx[5]
      const w = raw.width ?? 0
      const h = raw.height && raw.height > 0 ? raw.height : Math.hypot(tx[2], tx[3])
      const charW = str.length > 0 ? w / str.length : w

      let from = 0
      let idx = lower.indexOf(needle, from)
      while (idx !== -1) {
        const matchX = x + idx * charW
        const matchW = needle.length * charW
        out.push({
          page: n,
          rect: {
            x: matchX / vp.width,
            y: 1 - (y + h) / vp.height,
            w: matchW / vp.width,
            h: h / vp.height
          }
        })
        from = idx + needle.length
        idx = lower.indexOf(needle, from)
      }
    }
  }
  return out
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch debe usarse dentro de <SearchProvider>')
  return ctx
}
