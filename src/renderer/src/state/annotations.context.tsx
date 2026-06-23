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
import type { Annotation } from '@shared/ipc-contract'
import { useDocument } from './document.store'
import { annotationsClient } from '../services/annotations.client'
import { ClientError } from '../services/document.client'

export type AnnotationTool =
  | 'select'
  | 'highlight'
  | 'underline'
  | 'rect'
  | 'ink'
  | 'note'
  | 'text'
  | 'image'

const DEFAULT_COLORS: Record<Exclude<AnnotationTool, 'select'>, string> = {
  highlight: '#ffeb3b',
  underline: '#ff5252',
  rect: '#4c8dff',
  ink: '#000000',
  note: '#ffe082',
  text: '#000000',
  image: '#000000'
}

/** Tamaño de fuente del texto, como fracción de la altura de página. */
const DEFAULT_TEXT_SIZE = 0.022

/** Imagen elegida pendiente de colocar (firma). */
export interface PendingImage {
  dataBase64: string
  format: 'png' | 'jpg'
}

interface AnnotationsContextValue {
  annotations: Annotation[]
  tool: AnnotationTool
  color: string
  textSize: number
  pendingImage: PendingImage | null
  selectedId: string | null
  busy: boolean
  toolbarOpen: boolean
  setToolbarOpen: (open: boolean) => void
  setTool: (tool: AnnotationTool) => void
  setColor: (color: string) => void
  setTextSize: (size: number) => void
  add: (ann: Annotation) => void
  updateNote: (id: string, text: string) => void
  updateText: (id: string, text: string) => void
  select: (id: string | null) => void
  /** Desplaza una anotación por un delta normalizado (0..1). */
  move: (id: string, dx: number, dy: number) => void
  remove: (id: string) => void
  clear: () => void
  /** Abre el diálogo para elegir una imagen/firma y activa la herramienta. */
  chooseImage: () => Promise<void>
  /** Graba todas las anotaciones en el PDF y vacía la capa. */
  apply: () => Promise<void>
}

const AnnotationsContext = createContext<AnnotationsContextValue | null>(null)

export function AnnotationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, applyDocUpdate, reportError, editMode, requestEditMode, exitEditMode, registerEditor } =
    useDocument()
  const docId = state.doc?.id ?? null

  // La barra de anotaciones está abierta cuando el modo de edición es "annotate".
  const toolbarOpen = editMode === 'annotate'
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [tool, setToolState] = useState<AnnotationTool>('select')
  const [color, setColor] = useState<string>(DEFAULT_COLORS.highlight)
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE)
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Al cambiar de documento, descartamos las anotaciones en curso.
  useEffect(() => {
    setAnnotations([])
    setSelectedId(null)
    setToolState('select')
    setPendingImage(null)
  }, [docId])

  // Abrir/cerrar la barra pasa por el coordinador del store (que pregunta si hay
  // cambios sin grabar antes de cambiar de modo).
  const setToolbarOpen = useCallback(
    (open: boolean) => {
      void requestEditMode(open ? 'annotate' : null)
    },
    [requestEditMode]
  )

  // Al salir del modo "annotate" se restablece la herramienta y la selección.
  useEffect(() => {
    if (editMode !== 'annotate') {
      setToolState('select')
      setSelectedId(null)
      setPendingImage(null)
    }
  }, [editMode])

  const setTool = useCallback((next: AnnotationTool) => {
    setToolState(next)
    setSelectedId(null)
    if (next !== 'select') setColor(DEFAULT_COLORS[next])
    if (next !== 'image') setPendingImage(null)
  }, [])

  const chooseImage = useCallback(async () => {
    try {
      const img = await annotationsClient.pickImage()
      setPendingImage(img)
      setToolState('image')
      setSelectedId(null)
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'No se pudo cargar la imagen')
      }
    }
  }, [reportError])

  const add = useCallback((ann: Annotation) => setAnnotations((prev) => [...prev, ann]), [])

  const updateText = useCallback(
    (id: string, text: string) =>
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id && a.type === 'text' ? { ...a, text } : a))
      ),
    []
  )

  const updateNote = useCallback(
    (id: string, text: string) =>
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id && a.type === 'note' ? { ...a, text } : a))
      ),
    []
  )

  const select = useCallback((id: string | null) => setSelectedId(id), [])

  const move = useCallback((id: string, dx: number, dy: number) => {
    setAnnotations((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        switch (a.type) {
          case 'note':
          case 'text':
            return { ...a, pos: { x: clampUnit(a.pos.x + dx), y: clampUnit(a.pos.y + dy) } }
          case 'ink':
            return { ...a, points: a.points.map((p) => ({ x: clampUnit(p.x + dx), y: clampUnit(p.y + dy) })) }
          case 'highlight':
          case 'underline':
          case 'rect':
          case 'image':
            return { ...a, rect: { ...a.rect, x: clampUnit(a.rect.x + dx), y: clampUnit(a.rect.y + dy) } }
          default:
            return a
        }
      })
    )
  }, [])

  const remove = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
  }, [])

  const clear = useCallback(() => {
    setAnnotations([])
    setSelectedId(null)
  }, [])

  const apply = useCallback(async () => {
    if (!docId || annotations.length === 0) return
    setBusy(true)
    try {
      const updated = await annotationsClient.burn(docId, annotations)
      applyDocUpdate(updated)
      setAnnotations([])
      setSelectedId(null)
      exitEditMode()
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al grabar anotaciones')
      }
    } finally {
      setBusy(false)
    }
  }, [docId, annotations, applyDocUpdate, reportError, exitEditMode])

  // Registra en el coordinador si hay anotaciones SIN grabar y cómo grabarlas
  // (apply) o descartarlas (clear), para avisar al cambiar de modo/cerrar/guardar.
  useEffect(() => {
    registerEditor('annotate', { hasPending: annotations.length > 0, apply, discard: clear })
  }, [annotations, apply, clear, registerEditor])

  // Borrar la anotación seleccionada con Supr/Backspace (salvo escribiendo texto).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!selectedId) return
      const el = document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return
      e.preventDefault()
      remove(selectedId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, remove])

  const value = useMemo(
    () => ({
      annotations,
      tool,
      color,
      textSize,
      pendingImage,
      selectedId,
      busy,
      toolbarOpen,
      setToolbarOpen,
      setTool,
      setColor,
      setTextSize,
      add,
      updateNote,
      updateText,
      select,
      move,
      remove,
      clear,
      chooseImage,
      apply
    }),
    [
      annotations,
      tool,
      color,
      textSize,
      pendingImage,
      selectedId,
      busy,
      toolbarOpen,
      setToolbarOpen,
      setTool,
      add,
      updateNote,
      updateText,
      select,
      move,
      remove,
      clear,
      chooseImage,
      apply
    ]
  )

  return <AnnotationsContext.Provider value={value}>{children}</AnnotationsContext.Provider>
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function useAnnotations(): AnnotationsContextValue {
  const ctx = useContext(AnnotationsContext)
  if (!ctx) throw new Error('useAnnotations debe usarse dentro de <AnnotationsProvider>')
  return ctx
}
