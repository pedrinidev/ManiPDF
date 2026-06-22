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
  ensurePage: (pageNumber: number) => void
  getPlates: (pageNumber: number) => DecodedPlate[] | undefined
  exportAll: () => Promise<void>
  exportGrayPdf: () => Promise<void>
}

const SeparationsContext = createContext<SeparationsContextValue | null>(null)

export function SeparationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, reportError } = useDocument()
  const docId = state.doc?.id ?? null

  const [active, setActive] = useState(false)
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

  const reset = useCallback(() => {
    setCache(new Map())
    setInkNames([])
    loadingRef.current = new Set()
  }, [])

  // Al cambiar de documento, salimos y limpiamos.
  useEffect(() => {
    setActive(false)
    setEnabled(new Set())
    reset()
  }, [docId, reset])

  const start = useCallback(() => setActive(true), [])
  const exit = useCallback(() => {
    setActive(false)
    reset()
  }, [reset])

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

  const ensurePage = useCallback(
    (pageNumber: number) => {
      if (!docId || !active) return
      if (cache.has(pageNumber) || loadingRef.current.has(pageNumber)) return
      loadingRef.current.add(pageNumber)
      setBusy(true)
      separationsClient
        .render(docId, pageNumber, dpi, mode)
        .then(({ space: usedSpace, tiffBase64 }) => {
          setSpace(usedSpace)
          const decoded =
            usedSpace === 'rgb' ? decodeRgbPlates(tiffBase64) : decodeCmykPlates(tiffBase64)
          setCache((prev) => new Map(prev).set(pageNumber, decoded))
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
          if (!(err instanceof ClientError && err.isCancellation)) {
            reportError(err instanceof Error ? err.message : 'Error al separar colores')
          }
        })
        .finally(() => {
          loadingRef.current.delete(pageNumber)
          setBusy(loadingRef.current.size > 0)
        })
    },
    [docId, active, cache, dpi, mode, reportError]
  )

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
      getPlates,
      exportAll,
      exportGrayPdf
    }),
    [active, dpi, enabled, inkNames, busy, grayView, mode, space, start, exit, setDpi, setMode, toggle, toggleGrayView, ensurePage, getPlates, exportAll, exportGrayPdf]
  )

  return <SeparationsContext.Provider value={value}>{children}</SeparationsContext.Provider>
}

export function useSeparations(): SeparationsContextValue {
  const ctx = useContext(SeparationsContext)
  if (!ctx) throw new Error('useSeparations debe usarse dentro de <SeparationsProvider>')
  return ctx
}
