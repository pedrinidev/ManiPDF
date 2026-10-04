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
import { useDocument } from './document.store'
import { separationsClient } from '../services/separations.client'
import { ClientError } from '../services/document.client'
import type { SeparationMode, SeparationSpace } from '@shared/ipc-contract'
import {
  compositeImageData,
  compositeRgbImageData,
  decodeCmykPlates,
  decodeRgbPlates,
  imageDataToPngBase64,
  limitPlateCache,
  plateGrayImageData,
  type DecodedPlate
} from '../services/separation-utils'

interface SeparationsContextValue {
  active: boolean
  dpi: number
  enabled: Set<string>
  inkNames: string[]
  busy: boolean
  /** Vista en gris (planchas/film) en vez de compuesto en color. */
  grayView: boolean
  /** Modo elegido por el usuario: auto/cmyk/rgb. */
  mode: SeparationMode
  /** Espacio realmente usado en la última separación (detectado o forzado). */
  space: SeparationSpace | null
  start: () => void
  exit: () => void
  setDpi: (dpi: number) => void
  setMode: (mode: SeparationMode) => void
  toggle: (name: string) => void
  toggleGrayView: () => void
  /** Una página del visor que muestra la separación (se monta). */
  ensurePage: (pageNumber: number) => void
  /** La página deja de mostrarse (se desmonta): sus planchas pueden descartarse. */
  releasePage: (pageNumber: number) => void
  getPlates: (pageNumber: number) => DecodedPlate[] | undefined
  exportAll: () => Promise<void>
  exportGrayPdf: () => Promise<void>
}

const SeparationsContext = createContext<SeparationsContextValue | null>(null)

/** Renders de Ghostscript simultáneos (antes, uno por página a la vez). */
const MAX_IN_FLIGHT = 2
/** Páginas con planchas en memoria; se descartan las más alejadas de la vista. */
const MAX_CACHED_PAGES = 6

/** Una página pendiente de separar, con el contexto con el que se pidió. */
interface PendingRender {
  pageNumber: number
  generation: number
  docId: string
  dpi: number
  mode: SeparationMode
}

export function SeparationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, reportError } = useDocument()
  const docId = state.doc?.id ?? null

  // El modo "separación" se recuerda POR documento: al volver a una pestaña que lo
  // tenía abierto, el panel sigue ahí (no hay que reabrirlo desde Herramientas).
  const [activeDocs, setActiveDocs] = useState<Set<string>>(new Set())
  const active = docId ? activeDocs.has(docId) : false
  // Resolución fija a la mejor disponible para la previsualización/exportación de planchas.
  const [dpi, setDpiState] = useState(300)
  const [enabled, setEnabled] = useState<Set<string>>(new Set())
  const [inkNames, setInkNames] = useState<string[]>([])
  const [cache, setCache] = useState<Map<number, DecodedPlate[]>>(new Map())
  const [busy, setBusy] = useState(false)
  const [grayView, setGrayView] = useState(false)
  const [mode, setModeState] = useState<SeparationMode>('auto')
  const [space, setSpace] = useState<SeparationSpace | null>(null)
  const loadingRef = useRef<Set<number>>(new Set())
  // Cada cambio de documento, modo o resolución abre una «generación» nueva: los
  // renders de la anterior que lleguen tarde se descartan (antes se pintaban las
  // planchas de otro documento o del modo anterior).
  const generationRef = useRef(0)
  const queueRef = useRef<PendingRender[]>([])
  const inFlightRef = useRef(0)
  // Páginas montadas ahora en el visor: sus planchas nunca se descartan (si no,
  // con muchas páginas visibles se regenerarían en bucle).
  const mountedRef = useRef<Map<number, number>>(new Map())

  const reset = useCallback(() => {
    generationRef.current += 1
    queueRef.current = []
    setCache(new Map())
    setInkNames([])
    loadingRef.current = new Set()
    setBusy(false)
  }, [])

  // Al cambiar de documento limpiamos la caché de planchas (están cacheadas por
  // nº de página, no por documento). El flag "activo" NO se toca: es por documento
  // (activeDocs), así el panel reaparece al volver a su pestaña y se regenera.
  useEffect(() => {
    setEnabled(new Set())
    reset()
  }, [docId, reset])

  const start = useCallback(() => {
    if (docId) setActiveDocs((prev) => new Set(prev).add(docId))
  }, [docId])
  const exit = useCallback(() => {
    if (docId) {
      setActiveDocs((prev) => {
        const next = new Set(prev)
        next.delete(docId)
        return next
      })
    }
    reset()
  }, [docId, reset])

  const setDpi = useCallback(
    (d: number) => {
      setDpiState(d)
      reset() // las planchas dependen del dpi: hay que regenerarlas
    },
    [reset]
  )

  const toggle = useCallback(
    (name: string) =>
      setEnabled((prev) => {
        const next = new Set(prev)
        next.has(name) ? next.delete(name) : next.add(name)
        return next
      }),
    []
  )

  const toggleGrayView = useCallback(() => setGrayView((v) => !v), [])

  const setMode = useCallback(
    (m: SeparationMode) => {
      setModeState(m)
      setEnabled(new Set()) // cambian las tintas (CMYK↔RGB)
      setSpace(null)
      reset()
    },
    [reset]
  )

  /** Lanza renders pendientes sin superar MAX_IN_FLIGHT. */
  const pump = useCallback(() => {
    while (inFlightRef.current < MAX_IN_FLIGHT && queueRef.current.length > 0) {
      const job = queueRef.current.shift() as PendingRender
      inFlightRef.current += 1
      const current = (): boolean => job.generation === generationRef.current
      separationsClient
        .render(job.docId, job.pageNumber, job.dpi, job.mode)
        .then(({ space: usedSpace, tiffBase64 }) => {
          if (!current()) return
          setSpace(usedSpace)
          const decoded =
            usedSpace === 'rgb' ? decodeRgbPlates(tiffBase64) : decodeCmykPlates(tiffBase64)
          setCache((prev) =>
            limitPlateCache(new Map(prev).set(job.pageNumber, decoded), job.pageNumber, mountedRef.current, MAX_CACHED_PAGES)
          )
          setInkNames((prev) => {
            const set = new Set(prev)
            decoded.forEach((d) => set.add(d.name))
            return [...set]
          })
          // Activa por defecto cualquier tinta nueva descubierta.
          setEnabled((prev) => {
            const next = new Set(prev)
            decoded.forEach((d) => next.add(d.name))
            return next
          })
        })
        .catch((err) => {
          if (current() && !(err instanceof ClientError && err.isCancellation)) {
            reportError(err instanceof Error ? err.message : 'Error al separar colores')
          }
        })
        .finally(() => {
          inFlightRef.current -= 1
          if (current()) {
            loadingRef.current.delete(job.pageNumber)
            setBusy(loadingRef.current.size > 0)
          }
          pump()
        })
    }
  }, [reportError])

  const ensurePage = useCallback(
    (pageNumber: number) => {
      const mounted = mountedRef.current
      mounted.set(pageNumber, (mounted.get(pageNumber) ?? 0) + 1)
      if (!docId || !active) return
      if (cache.has(pageNumber) || loadingRef.current.has(pageNumber)) return
      loadingRef.current.add(pageNumber)
      setBusy(true)
      queueRef.current.push({ pageNumber, generation: generationRef.current, docId, dpi, mode })
      pump()
    },
    [docId, active, cache, dpi, mode, pump]
  )

  const releasePage = useCallback((pageNumber: number) => {
    const mounted = mountedRef.current
    const count = (mounted.get(pageNumber) ?? 1) - 1
    if (count > 0) mounted.set(pageNumber, count)
    else mounted.delete(pageNumber)
  }, [])

  const getPlates = useCallback((pageNumber: number) => cache.get(pageNumber), [cache])

  const exportAll = useCallback(async () => {
    const isRgb = space === 'rgb'
    const files: { name: string; pngBase64: string }[] = []
    for (const [pageNumber, plates] of cache) {
      const composite = isRgb
        ? compositeRgbImageData(plates, enabled)
        : compositeImageData(plates, enabled)
      files.push({
        name: `pagina-${pageNumber}-compuesto.png`,
        pngBase64: imageDataToPngBase64(composite)
      })
      for (const plate of plates) {
        files.push({
          name: `pagina-${pageNumber}-${plate.name}.png`,
          pngBase64: imageDataToPngBase64(plateGrayImageData(plate, isRgb))
        })
      }
    }
    if (files.length === 0) return
    try {
      await separationsClient.exportFiles(files)
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al exportar separaciones')
      }
    }
  }, [cache, enabled, space, reportError])

  const exportGrayPdf = useCallback(async () => {
    if (!docId) return
    try {
      await separationsClient.exportGray(docId)
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al exportar en grises')
      }
    }
  }, [docId, reportError])

  const value = useMemo(
    () => ({
      active,
      dpi,
      enabled,
      inkNames,
      busy,
      grayView,
      mode,
      space,
      start,
      exit,
      setDpi,
      setMode,
      toggle,
      toggleGrayView,
      ensurePage,
      releasePage,
      getPlates,
      exportAll,
      exportGrayPdf
    }),
    [active, dpi, enabled, inkNames, busy, grayView, mode, space, start, exit, setDpi, setMode, toggle, toggleGrayView, ensurePage, releasePage, getPlates, exportAll, exportGrayPdf]
  )

  return <SeparationsContext.Provider value={value}>{children}</SeparationsContext.Provider>
}

export function useSeparations(): SeparationsContextValue {
  const ctx = useContext(SeparationsContext)
  if (!ctx) throw new Error('useSeparations debe usarse dentro de <SeparationsProvider>')
  return ctx
}
