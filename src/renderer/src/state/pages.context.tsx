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
import type { OpenDocumentDTO, RotationDelta } from '@shared/ipc-contract'
import { useDocument } from './document.store'
import { pagesClient } from '../services/pages.client'
import { ClientError } from '../services/document.client'

interface PagesContextValue {
  selected: Set<number>
  selectedArray: number[]
  hasSelection: boolean
  busy: boolean
  total: number
  select: (index: number, mods: { shift: boolean; meta: boolean }) => void
  rotate: (delta: RotationDelta) => Promise<void>
  remove: () => Promise<void>
  duplicate: () => Promise<void>
  extract: () => Promise<void>
  insert: () => Promise<void>
  reorder: (from: number, to: number) => Promise<void>
}

const PagesContext = createContext<PagesContextValue | null>(null)

export function PagesProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()
  const doc = state.doc
  const total = doc?.pageCount ?? 0

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const anchorRef = useRef<number>(0)

  useEffect(() => setSelected(new Set()), [doc?.id])
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((i) => i < total)))
  }, [total])

  const select = useCallback((index: number, mods: { shift: boolean; meta: boolean }) => {
    setSelected((prev) => {
      if (mods.shift) {
        const [a, b] = [anchorRef.current, index].sort((x, y) => x - y)
        return new Set(rangeBetween(a, b))
      }
      if (mods.meta) {
        const next = new Set(prev)
        next.has(index) ? next.delete(index) : next.add(index)
        anchorRef.current = index
        return next
      }
      anchorRef.current = index
      return new Set([index])
    })
  }, [])

  const runOp = useCallback(
    async (op: () => Promise<OpenDocumentDTO>) => {
      setBusy(true)
      try {
        applyDocUpdate(await op())
      } catch (err) {
        if (!(err instanceof ClientError && err.isCancellation)) {
          reportError(err instanceof Error ? err.message : 'Error en la operación de páginas')
        }
      } finally {
        setBusy(false)
      }
    },
    [applyDocUpdate, reportError]
  )

  const selectedArray = useMemo(() => [...selected].sort((a, b) => a - b), [selected])
  const id = doc?.id ?? ''

  const rotate = useCallback(
    (delta: RotationDelta) => runOp(() => pagesClient.rotate(id, selectedArray, delta)),
    [id, selectedArray, runOp]
  )
  const remove = useCallback(() => runOp(() => pagesClient.remove(id, selectedArray)), [id, selectedArray, runOp])
  const duplicate = useCallback(
    () => runOp(() => pagesClient.duplicate(id, selectedArray)),
    [id, selectedArray, runOp]
  )
  const insert = useCallback(() => {
    const at = selectedArray.length > 0 ? Math.max(...selectedArray) + 1 : total
    return runOp(() => pagesClient.insert(id, at))
  }, [id, selectedArray, total, runOp])

  const extract = useCallback(async () => {
    if (!id) return
    setBusy(true)
    try {
      await pagesClient.extract(id, selectedArray)
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al extraer')
      }
    } finally {
      setBusy(false)
    }
  }, [id, selectedArray, reportError])

  const reorder = useCallback(
    (from: number, to: number) => {
      if (from === to) return Promise.resolve()
      return runOp(() => pagesClient.reorder(id, moveIndex(total, from, to)))
    },
    [id, total, runOp]
  )

  const value = useMemo(
    () => ({
      selected,
      selectedArray,
      hasSelection: selectedArray.length > 0,
      busy,
      total,
      select,
      rotate,
      remove,
      duplicate,
      extract,
      insert,
      reorder
    }),
    [selected, selectedArray, busy, total, select, rotate, remove, duplicate, extract, insert, reorder]
  )

  return <PagesContext.Provider value={value}>{children}</PagesContext.Provider>
}

/** Permutación al mover el índice `from` a la posición `to`. */
function moveIndex(total: number, from: number, to: number): number[] {
  const order = Array.from({ length: total }, (_, i) => i)
  order.splice(from, 1)
  order.splice(from < to ? to - 1 : to, 0, from)
  return order
}

function rangeBetween(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i)
}

export function usePages(): PagesContextValue {
  const ctx = useContext(PagesContext)
  if (!ctx) throw new Error('usePages debe usarse dentro de <PagesProvider>')
  return ctx
}
