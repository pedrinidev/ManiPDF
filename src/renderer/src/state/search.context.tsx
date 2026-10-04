import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type JSX
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RectArea } from '@shared/ipc-contract'
import { useDocument } from './document.store'
import { usePdf } from './pdf.context'
import {
  buildSearchIndex,
  findMatches,
  matchRects,
  normalizeQuery,
  type PageGeometry,
  type SearchIndex,
  type SearchTextItem
} from '../services/text-search'

/**
 * Una coincidencia de búsqueda: página (1-based) y sus cajas normalizadas (0..1,
 * origen arriba). Varias si la frase cruza fragmentos de texto o líneas.
 */
export interface SearchMatch {
  page: number
  rects: RectArea[]
}

interface SearchContextValue {
  query: string
  matches: SearchMatch[]
  current: number // índice en matches, -1 si no hay
  searching: boolean
  /**
   * Coincidencia que hay que llevar a la vista: cambia al buscar algo nuevo y con
   * siguiente/anterior, pero NO cuando se recalcula por una edición del documento
   * (antes, cada edición con una búsqueda activa saltaba a la primera coincidencia).
   */
  reveal: { match: SearchMatch } | null
  setQuery: (q: string) => void
  next: () => void
  prev: () => void
  clear: () => void
}

const SearchContext = createContext<SearchContextValue | null>(null)

/** Mínimo de caracteres (ya normalizados) para buscar. */
const MIN_QUERY = 2

export function SearchProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useDocument()
  const { pdf } = usePdf()

  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const [current, setCurrent] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [reveal, setReveal] = useState<{ match: SearchMatch } | null>(null)
  // Consulta de los resultados mostrados: distingue «búsqueda nueva» de «recalcular
  // tras editar».
  const shownQuery = useRef('')

  // Al cambiar de documento, limpia resultados.
  useEffect(() => {
    setMatches([])
    setCurrent(-1)
    shownQuery.current = ''
  }, [state.doc?.id])

  // Busca (con un pequeño debounce) cada vez que cambia la consulta o el documento.
  useEffect(() => {
    const q = normalizeQuery(query)
    if (!pdf || q.length < MIN_QUERY) {
      setMatches([])
      setCurrent(-1)
      setSearching(false) // antes podía quedarse en «…» al borrar la consulta
      shownQuery.current = ''
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const found = await computeMatches(pdf, q, () => cancelled)
        if (cancelled) return
        const isNewQuery = q !== shownQuery.current
        shownQuery.current = q
        setMatches(found)
        setCurrent((c) =>
          found.length === 0 ? -1 : isNewQuery ? 0 : Math.min(Math.max(c, 0), found.length - 1)
        )
        if (isNewQuery) setReveal(found.length > 0 ? { match: found[0] } : null)
      } catch {
        // pdf.js destruido (el documento se recargó): la búsqueda se repite con el nuevo.
        if (!cancelled) {
          setMatches([])
          setCurrent(-1)
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
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

  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return
      const index = (((current + delta) % matches.length) + matches.length) % matches.length
      setCurrent(index)
      setReveal({ match: matches[index] })
    },
    [matches, current]
  )
  const next = useCallback(() => step(1), [step])
  const prev = useCallback(() => step(-1), [step])

  const value = useMemo(
    () => ({ query, matches, current, searching, reveal, setQuery, next, prev, clear }),
    [query, matches, current, searching, reveal, next, prev, clear]
  )

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}

/** Texto de una página preparado para buscar (se calcula una vez por documento cargado). */
interface PageSearchData {
  items: SearchTextItem[]
  /** Familia CSS aproximada de cada fragmento, para repartir su ancho entre caracteres. */
  families: string[]
  index: SearchIndex
  geometry: PageGeometry
}

/**
 * Caché por instancia de pdf.js: antes cada pulsación volvía a extraer el texto
 * de todas las páginas. Al editar, la instancia cambia y la caché anterior se
 * libera sola.
 */
const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageSearchData>>>()

function pageSearchData(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageSearchData> {
  let pages = pageCache.get(pdf)
  if (!pages) {
    pages = new Map()
    pageCache.set(pdf, pages)
  }
  let data = pages.get(pageNumber)
  if (!data) {
    data = loadPageSearchData(pdf, pageNumber)
    data.catch(() => pages.delete(pageNumber)) // un fallo no queda en la caché
    pages.set(pageNumber, data)
  }
  return data
}

async function loadPageSearchData(pdf: PDFDocumentProxy, pageNumber: number): Promise<PageSearchData> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items: SearchTextItem[] = []
  const families: string[] = []
  for (const raw of content.items) {
    if (!('str' in raw)) continue
    items.push({ str: raw.str, transform: raw.transform, width: raw.width, height: raw.height, hasEOL: raw.hasEOL })
    families.push(content.styles[raw.fontName]?.fontFamily ?? 'sans-serif')
  }
  return {
    items,
    families,
    index: buildSearchIndex(items),
    geometry: {
      width: viewport.width,
      height: viewport.height,
      toViewport: (x, y) => viewport.convertToViewportPoint(x, y)
    }
  }
}

/** Mide textos con un canvas (solo proporciones: el ancho real lo da pdf.js). */
let measureContext: CanvasRenderingContext2D | null = null
function measurer(family: string): (text: string) => number {
  measureContext ??= document.createElement('canvas').getContext('2d')
  const context = measureContext
  if (!context) return (text) => text.length
  return (text) => {
    context.font = `100px ${family}`
    return context.measureText(text).width
  }
}

async function computeMatches(
  pdf: PDFDocumentProxy,
  query: string,
  isCancelled: () => boolean
): Promise<SearchMatch[]> {
  const out: SearchMatch[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const data = await pageSearchData(pdf, n)
    if (isCancelled()) return out
    for (const segments of findMatches(data.index, query)) {
      out.push({
        page: n,
        rects: matchRects(segments, data.items, data.geometry, (item) => measurer(data.families[item]))
      })
    }
  }
  return out
}

export function useSearch(): SearchContextValue {
  const ctx = useContext(SearchContext)
  if (!ctx) throw new Error('useSearch debe usarse dentro de <SearchProvider>')
  return ctx
}
