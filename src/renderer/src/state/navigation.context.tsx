import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type JSX
} from 'react'
import { useDocument } from './document.store'
import { usePdf } from './pdf.context'
import { CURRENT_PAGE_PROBE, pageWrapper, scrollToPage } from '../services/navigate'
import { clampPage, pageIndexAt } from '../services/navigation-math'

/**
 * Navegación por el documento: qué página se está viendo, saltar a una página y
 * conservar la posición al cambiar el zoom. Lo usan la barra (ir a página), el
 * panel de miniaturas, los marcadores y los enlaces internos.
 */
interface NavigationContextValue {
  /** Página que se está viendo (1-based). */
  currentPage: number
  /** Nº de páginas del documento visible (0 si no hay). */
  pageCount: number
  goToPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
  /** El visor registra aquí su contenedor desplazable. */
  registerScrollContainer: (el: HTMLElement | null) => void
}

/** Punto del documento que debe quedar fijo al cambiar el zoom. */
interface ViewAnchor {
  docId: string
  page: number
  /** Posición de la línea de referencia dentro de la página (0 = borde superior). */
  fraction: number
  /** Centro horizontal visible, como fracción del ancho desplazable. */
  centerX: number
}

/** Salto pedido explícitamente: manda mientras el usuario no vuelva a desplazarse. */
interface PinnedPage {
  docId: string
  page: number
  scrollTop: number
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function NavigationProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useDocument()
  const { pdf } = usePdf()
  const docId = state.doc?.id ?? null
  const zoom = state.zoom
  const pageCount = pdf?.numPages ?? 0

  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const anchorRef = useRef<ViewAnchor | null>(null)
  const pinnedRef = useRef<PinnedPage | null>(null)

  /** Recalcula la página actual (y el ancla del zoom) a partir de la posición de scroll. */
  const measure = useCallback(() => {
    if (!container || !docId) return
    const wrappers = container.querySelectorAll<HTMLElement>('.page-wrapper')
    const count = wrappers.length
    if (count === 0) return
    const box = container.getBoundingClientRect()
    const probe = box.top + CURRENT_PAGE_PROBE

    let index = pageIndexAt(count, (i) => wrappers[i].getBoundingClientRect(), probe)
    // Tras un salto («ir a página», miniatura…) la página pedida manda aunque no
    // pueda subir hasta arriba (p. ej. la última), hasta que el usuario se desplace.
    const pinned = pinnedRef.current
    if (
      pinned &&
      pinned.docId === docId &&
      pinned.page <= count &&
      Math.abs(container.scrollTop - pinned.scrollTop) < 2
    ) {
      index = pinned.page - 1
    } else {
      pinnedRef.current = null
    }

    const r = wrappers[index].getBoundingClientRect()
    anchorRef.current = {
      docId,
      page: index + 1,
      fraction: r.height > 0 ? Math.min(1, Math.max(0, (probe - r.top) / r.height)) : 0,
      centerX:
        container.scrollWidth > 0
          ? (container.scrollLeft + container.clientWidth / 2) / container.scrollWidth
          : 0.5
    }
    setCurrentPage(index + 1)
  }, [container, docId])

  // Página actual al desplazarse (como mucho una medición por fotograma).
  useEffect(() => {
    if (!container) return
    let frame = 0
    const onScroll = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [container, measure])

  // Otro documento: se empieza por la página 1 y se olvidan ancla y salto.
  useEffect(() => {
    setCurrentPage(1)
    anchorRef.current = null
    pinnedRef.current = null
  }, [docId])

  // Documento cargado o recargado tras editar: medir cuando ya está maquetado.
  useEffect(() => {
    if (!pdf) return
    const frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [pdf, measure])

  // Al cambiar el zoom se conserva el punto que se estaba viendo. Las páginas ya
  // tienen su nuevo tamaño en este momento (lo fija React a partir de pageSizes),
  // así que basta un ajuste antes de pintar.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!container || !anchor || anchor.docId !== docId) return
    const wrapper = pageWrapper(container, anchor.page)
    if (!wrapper) return
    const box = container.getBoundingClientRect()
    const r = wrapper.getBoundingClientRect()
    container.scrollTop += r.top + anchor.fraction * r.height - (box.top + CURRENT_PAGE_PROBE)
    container.scrollLeft = anchor.centerX * container.scrollWidth - container.clientWidth / 2
    // Solo debe reaccionar al zoom; el resto (contenedor, documento) se lee en el momento.
  }, [zoom])

  const goToPage = useCallback(
    (page: number) => {
      if (!container || !docId || pageCount === 0) return
      const target = clampPage(page, pageCount)
      if (!scrollToPage(container, target)) return
      pinnedRef.current = { docId, page: target, scrollTop: container.scrollTop }
      measure()
    },
    [container, docId, pageCount, measure]
  )
  const nextPage = useCallback(() => goToPage(currentPage + 1), [goToPage, currentPage])
  const prevPage = useCallback(() => goToPage(currentPage - 1), [goToPage, currentPage])

  const value = useMemo(
    () => ({
      currentPage: pageCount > 0 ? Math.min(currentPage, pageCount) : 0,
      pageCount,
      goToPage,
      nextPage,
      prevPage,
      registerScrollContainer: setContainer
    }),
    [currentPage, pageCount, goToPage, nextPage, prevPage]
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext)
  if (!ctx) throw new Error('useNavigation debe usarse dentro de <NavigationProvider>')
  return ctx
}
