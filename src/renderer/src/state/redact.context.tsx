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
import type { RectArea, RedactedPage } from '@shared/ipc-contract'
import { useDocument } from './document.store'
import { usePdf } from './pdf.context'
import { redactClient } from '../services/redact.client'
import { renderPageRedacted } from '../services/pdf-renderer'
import { ClientError } from '../services/document.client'

const REDACT_SCALE = 2

/** Una zona a redactar: página (1-based) y caja normalizada (0..1, origen arriba). */
export interface RedactRect {
  id: string
  page: number
  rect: RectArea
}

interface RedactContextValue {
  active: boolean
  rects: RedactRect[]
  busy: boolean
  start: () => void
  exit: () => void
  addRect: (page: number, rect: RectArea) => void
  removeRect: (id: string) => void
  apply: () => Promise<void>
}

const RedactContext = createContext<RedactContextValue | null>(null)

export function RedactProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, applyDocUpdate, reportError, editMode, requestEditMode, exitEditMode, registerEditor } =
    useDocument()
  const { pdf } = usePdf()

  // El modo "censurar" está activo cuando el modo de edición del store es 'redact'.
  const active = editMode === 'redact'
  const [rects, setRects] = useState<RedactRect[]>([])
  const [busy, setBusy] = useState(false)

  // Al cambiar de documento, limpiamos las zonas en curso (el store sale del modo).
  useEffect(() => {
    setRects([])
  }, [state.doc?.id])

  const start = useCallback(() => void requestEditMode('redact'), [requestEditMode])
  const exit = useCallback(() => void requestEditMode(null), [requestEditMode])

  const addRect = useCallback(
    (page: number, rect: RectArea) =>
      setRects((prev) => [...prev, { id: crypto.randomUUID(), page, rect }]),
    []
  )
  const removeRect = useCallback((id: string) => setRects((prev) => prev.filter((r) => r.id !== id)), [])

  const apply = useCallback(async () => {
    if (!state.doc || !pdf || rects.length === 0) return
    setBusy(true)
    try {
      // Agrupa las zonas por página y rasteriza cada página afectada.
      const byPage = new Map<number, RectArea[]>()
      for (const r of rects) {
        const list = byPage.get(r.page) ?? []
        list.push(r.rect)
        byPage.set(r.page, list)
      }
      const pages: RedactedPage[] = []
      for (const [page, areas] of byPage) {
        const img = await renderPageRedacted(pdf, page, REDACT_SCALE, areas)
        pages.push({ pageIndex: page - 1, ...img })
      }
      const updated = await redactClient.apply(state.doc.id, pages)
      applyDocUpdate(updated)
      setRects([])
      exitEditMode()
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al redactar')
      }
    } finally {
      setBusy(false)
    }
  }, [state.doc, pdf, rects, applyDocUpdate, reportError, exitEditMode])

  // Registra en el coordinador si hay zonas sin grabar y cómo grabarlas/descartarlas.
  const discard = useCallback(() => setRects([]), [])
  useEffect(() => {
    registerEditor('redact', { hasPending: rects.length > 0, apply, discard })
  }, [rects, apply, discard, registerEditor])

  const value = useMemo(
    () => ({ active, rects, busy, start, exit, addRect, removeRect, apply }),
    [active, rects, busy, start, exit, addRect, removeRect, apply]
  )

  return <RedactContext.Provider value={value}>{children}</RedactContext.Provider>
}

export function useRedact(): RedactContextValue {
  const ctx = useContext(RedactContext)
  if (!ctx) throw new Error('useRedact debe usarse dentro de <RedactProvider>')
  return ctx
}
