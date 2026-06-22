import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type JSX
} from 'react'
import type { DocumentId, OpenDocumentDTO } from '@shared/ipc-contract'
import { documentClient, ClientError } from '../services/document.client'
import { addRecent } from '../services/recents'

/** Pila de deshacer/rehacer por documento: snapshots (dataBase64) del PDF. */
interface DocHistory {
  undo: string[]
  redo: string[]
}

/** Estado interno del reducer (lista de documentos abiertos + activo). */
interface InternalState {
  docs: OpenDocumentDTO[]
  activeId: DocumentId | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  zoom: number
  history: Record<DocumentId, DocHistory>
}

/** Máximo de pasos de deshacer guardados por documento (acota la memoria). */
const MAX_HISTORY = 25

/** Estado expuesto a la UI: incluye `doc` (el activo) por compatibilidad. */
export interface DocumentState extends InternalState {
  doc: OpenDocumentDTO | null
}

const initialState: InternalState = {
  docs: [],
  activeId: null,
  status: 'idle',
  error: null,
  zoom: 1,
  history: {}
}

type Action =
  | { type: 'LOADING' }
  | { type: 'LOADED'; doc: OpenDocumentDTO }
  | { type: 'DOC_UPDATED'; doc: OpenDocumentDTO }
  | { type: 'ERROR'; message: string }
  | { type: 'OPEN_CANCELLED' }
  | { type: 'CLOSED'; id: DocumentId }
  | { type: 'SET_ACTIVE'; id: DocumentId }
  | { type: 'SET_ZOOM'; zoom: number }
  | { type: 'MARK_SAVED'; id: DocumentId; filePath: string }
  | { type: 'UNDO'; id: DocumentId; doc: OpenDocumentDTO }
  | { type: 'REDO'; id: DocumentId; doc: OpenDocumentDTO }

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4

function reducer(state: InternalState, action: Action): InternalState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, status: 'loading', error: null }
    case 'LOADED':
      return {
        ...state,
        docs: [...state.docs, action.doc],
        activeId: action.doc.id,
        status: 'ready',
        error: null,
        zoom: 1,
        history: { ...state.history, [action.doc.id]: { undo: [], redo: [] } }
      }
    case 'DOC_UPDATED': {
      // Guarda el estado ANTERIOR en la pila de deshacer y limpia rehacer.
      const prev = state.docs.find((d) => d.id === action.doc.id)
      const h = state.history[action.doc.id] ?? { undo: [], redo: [] }
      const undo = prev ? [...h.undo, prev.dataBase64].slice(-MAX_HISTORY) : h.undo
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.doc.id ? action.doc : d)),
        history: { ...state.history, [action.doc.id]: { undo, redo: [] } },
        status: 'ready',
        error: null
      }
    }
    case 'ERROR':
      return { ...state, status: 'error', error: action.message }
    case 'OPEN_CANCELLED':
      return { ...state, status: state.docs.length > 0 ? 'ready' : 'idle', error: null }
    case 'CLOSED': {
      const docs = state.docs.filter((d) => d.id !== action.id)
      const activeId =
        state.activeId === action.id ? (docs.length > 0 ? docs[docs.length - 1].id : null) : state.activeId
      const history = { ...state.history }
      delete history[action.id]
      return { ...state, docs, activeId, history, status: docs.length > 0 ? 'ready' : 'idle' }
    }
    case 'SET_ACTIVE':
      return { ...state, activeId: action.id }
    case 'SET_ZOOM':
      return { ...state, zoom: clamp(action.zoom, MIN_ZOOM, MAX_ZOOM) }
    case 'MARK_SAVED':
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.id === action.id
            ? { ...d, isDirty: false, filePath: action.filePath, fileName: baseName(action.filePath) }
            : d
        )
      }
    case 'UNDO': {
      const cur = state.docs.find((d) => d.id === action.id)
      const h = state.history[action.id]
      if (!cur || !h || h.undo.length === 0) return state
      const undo = h.undo.slice(0, -1)
      const redo = [...h.redo, cur.dataBase64].slice(-MAX_HISTORY)
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.id ? action.doc : d)),
        history: { ...state.history, [action.id]: { undo, redo } },
        status: 'ready',
        error: null
      }
    }
    case 'REDO': {
      const cur = state.docs.find((d) => d.id === action.id)
      const h = state.history[action.id]
      if (!cur || !h || h.redo.length === 0) return state
      const redo = h.redo.slice(0, -1)
      const undo = [...h.undo, cur.dataBase64].slice(-MAX_HISTORY)
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.id ? action.doc : d)),
        history: { ...state.history, [action.id]: { undo, redo } },
        status: 'ready',
        error: null
      }
    }
    default:
      return state
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Nombre de archivo a partir de una ruta (para refrescar el título tras "Guardar como"). */
function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

interface DocumentContextValue {
  state: DocumentState
  openDialog: () => Promise<void>
  openByPath: (filePath: string) => Promise<void>
  save: () => Promise<void>
  saveAs: () => Promise<void>
  print: () => Promise<void>
  closeDoc: (id?: DocumentId) => Promise<void>
  setActive: (id: DocumentId) => void
  setZoom: (zoom: number) => void
  /** Reemplaza el documento (por id) tras una edición. */
  applyDocUpdate: (doc: OpenDocumentDTO) => void
  /** Muestra un error en el banner global. */
  reportError: (message: string) => void
  /**
   * El módulo de anotaciones registra aquí si hay anotaciones SIN grabar y una
   * función para grabarlas. Así Guardar/Cerrar pueden incrustarlas antes y el
   * documento se considera "con cambios" mientras existan.
   */
  registerPending: (has: boolean, flush: () => Promise<void>) => void
  /** true si el documento activo tiene anotaciones sin grabar. */
  hasUnsavedAnnotations: boolean
  /** Deshacer/rehacer la última edición del documento activo. */
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

export function DocumentProvider({ children }: { children: ReactNode }): JSX.Element {
  const [internal, dispatch] = useReducer(reducer, initialState)

  // Anotaciones sin grabar del documento activo + función para grabarlas.
  const flushRef = useRef<(() => Promise<void>) | null>(null)
  const [hasUnsavedAnnotations, setHasUnsavedAnnotations] = useState(false)
  const registerPending = useCallback((has: boolean, flush: () => Promise<void>) => {
    setHasUnsavedAnnotations(has)
    flushRef.current = flush
  }, [])

  const activeDoc = useMemo(
    () => internal.docs.find((d) => d.id === internal.activeId) ?? null,
    [internal.docs, internal.activeId]
  )
  const state: DocumentState = useMemo(() => ({ ...internal, doc: activeDoc }), [internal, activeDoc])

  const openDialog = useCallback(async () => {
    dispatch({ type: 'LOADING' })
    try {
      const doc = await documentClient.open()
      // Si ese archivo YA está abierto, no duplicamos pestaña: descartamos el
      // recién cargado (para no clonar el documento en memoria ni pisarse al
      // guardar) y activamos la pestaña existente.
      const existing = internal.docs.find((d) => d.filePath && d.filePath === doc.filePath && d.id !== doc.id)
      if (existing) {
        await documentClient.close(doc.id).catch(() => {})
        dispatch({ type: 'OPEN_CANCELLED' })
        dispatch({ type: 'SET_ACTIVE', id: existing.id })
        return
      }
      dispatch({ type: 'LOADED', doc })
      addRecent(doc.filePath, doc.fileName)
    } catch (err) {
      handleError(err, dispatch)
    }
  }, [internal.docs])

  const openByPath = useCallback(
    async (filePath: string) => {
      // Mismo archivo ya abierto → activar su pestaña en vez de duplicar.
      const existing = internal.docs.find((d) => d.filePath === filePath)
      if (existing) {
        dispatch({ type: 'SET_ACTIVE', id: existing.id })
        return
      }
      dispatch({ type: 'LOADING' })
      try {
        const doc = await documentClient.openPath(filePath)
        dispatch({ type: 'LOADED', doc })
        addRecent(doc.filePath, doc.fileName)
      } catch (err) {
        handleError(err, dispatch)
      }
    },
    [internal.docs]
  )

  // Informa al main si hay cambios sin guardar (incluye anotaciones pendientes).
  const anyDirty = internal.docs.some((d) => d.isDirty) || hasUnsavedAnnotations
  useEffect(() => {
    window.api.app.setDirty(anyDirty)
  }, [anyDirty])

  // Graba las anotaciones pendientes (si las hay) antes de guardar/cerrar.
  const flushPending = useCallback(async () => {
    if (hasUnsavedAnnotations && flushRef.current) await flushRef.current()
  }, [hasUnsavedAnnotations])

  const save = useCallback(async () => {
    if (!activeDoc) return
    try {
      await flushPending() // incrusta las anotaciones pendientes en el PDF
      const filePath = await documentClient.save(activeDoc.id)
      dispatch({ type: 'MARK_SAVED', id: activeDoc.id, filePath })
    } catch (err) {
      handleError(err, dispatch)
    }
  }, [activeDoc, flushPending])

  const saveAs = useCallback(async () => {
    if (!activeDoc) return
    try {
      await flushPending()
      const filePath = await documentClient.saveAs(activeDoc.id)
      dispatch({ type: 'MARK_SAVED', id: activeDoc.id, filePath })
    } catch (err) {
      handleError(err, dispatch)
    }
  }, [activeDoc, flushPending])

  const print = useCallback(async () => {
    if (!activeDoc) return
    try {
      await documentClient.print(activeDoc.id)
    } catch (err) {
      handleError(err, dispatch)
    }
  }, [activeDoc])

  const closeDoc = useCallback(
    async (id?: DocumentId) => {
      const target = id ?? activeDoc?.id
      if (!target) return
      const targetDoc = internal.docs.find((d) => d.id === target)
      const isActive = target === activeDoc?.id
      // "Sucio" = cambios grabados sin guardar O anotaciones pendientes (del activo).
      const dirty = !!targetDoc?.isDirty || (isActive && hasUnsavedAnnotations)

      if (dirty) {
        const choice = await window.api.app.confirmUnsaved({
          message: 'El documento tiene cambios sin guardar',
          detail: `¿Guardar "${targetDoc?.fileName ?? ''}" antes de cerrar la pestaña?`,
          saveLabel: 'Guardar'
        })
        if (choice === 'cancel') return
        if (choice === 'save') {
          try {
            if (isActive) await flushPending() // graba anotaciones pendientes
            const filePath = await documentClient.save(target)
            dispatch({ type: 'MARK_SAVED', id: target, filePath })
          } catch (err) {
            // Guardado cancelado (p. ej. diálogo "Guardar como") → no cerramos.
            if (err instanceof ClientError && err.isCancellation) return
            handleError(err, dispatch)
            return
          }
        }
        // 'discard' → seguimos y cerramos sin guardar.
      }

      try {
        await documentClient.close(target)
      } finally {
        dispatch({ type: 'CLOSED', id: target })
      }
    },
    [activeDoc, internal.docs, hasUnsavedAnnotations, flushPending]
  )

  const activeHistory = activeDoc ? internal.history[activeDoc.id] : undefined
  const canUndo = !!activeHistory && activeHistory.undo.length > 0
  const canRedo = !!activeHistory && activeHistory.redo.length > 0

  const undo = useCallback(async () => {
    if (!activeDoc) return
    const h = internal.history[activeDoc.id]
    if (!h || h.undo.length === 0) return
    try {
      const doc = await documentClient.restore(activeDoc.id, h.undo[h.undo.length - 1])
      dispatch({ type: 'UNDO', id: activeDoc.id, doc })
    } catch (err) {
      handleError(err, dispatch)
    }
  }, [activeDoc, internal.history])

  const redo = useCallback(async () => {
    if (!activeDoc) return
    const h = internal.history[activeDoc.id]
    if (!h || h.redo.length === 0) return
    try {
      const doc = await documentClient.restore(activeDoc.id, h.redo[h.redo.length - 1])
      dispatch({ type: 'REDO', id: activeDoc.id, doc })
    } catch (err) {
      handleError(err, dispatch)
    }
  }, [activeDoc, internal.history])

  const setActive = useCallback((id: DocumentId) => dispatch({ type: 'SET_ACTIVE', id }), [])
  const setZoom = useCallback((zoom: number) => dispatch({ type: 'SET_ZOOM', zoom }), [])
  const applyDocUpdate = useCallback((doc: OpenDocumentDTO) => dispatch({ type: 'DOC_UPDATED', doc }), [])
  const reportError = useCallback((message: string) => dispatch({ type: 'ERROR', message }), [])

  return (
    <DocumentContext.Provider
      value={{
        state,
        openDialog,
        openByPath,
        save,
        saveAs,
        print,
        closeDoc,
        setActive,
        setZoom,
        applyDocUpdate,
        reportError,
        registerPending,
        hasUnsavedAnnotations,
        undo,
        redo,
        canUndo,
        canRedo
      }}
    >
      {children}
    </DocumentContext.Provider>
  )
}

/** Una cancelación del usuario no es un error visible. */
function handleError(err: unknown, dispatch: Dispatch<Action>): void {
  if (err instanceof ClientError && err.isCancellation) {
    dispatch({ type: 'OPEN_CANCELLED' })
    return
  }
  const message = err instanceof Error ? err.message : 'Error inesperado'
  dispatch({ type: 'ERROR', message })
}

export function useDocument(): DocumentContextValue {
  const ctx = useContext(DocumentContext)
  if (!ctx) throw new Error('useDocument debe usarse dentro de <DocumentProvider>')
  return ctx
}
