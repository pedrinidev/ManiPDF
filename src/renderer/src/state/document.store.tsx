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

/** Pila de deshacer/rehacer por documento: snapshots (bytes) del PDF. */
interface DocHistory {
  undo: Uint8Array[]
  redo: Uint8Array[]
}

/** Modos de edición mutuamente excluyentes (solo uno activo a la vez). */
export type EditorKind = 'annotate' | 'fields' | 'redact'

/** Cómo grabar (apply) o descartar (discard) los cambios en curso de un modo. */
interface EditorDescriptor {
  apply: () => Promise<void>
  discard: () => void
}

const EDIT_LABELS: Record<EditorKind, string> = {
  annotate: 'Anotar',
  fields: 'Crear campos',
  redact: 'Censurar'
}

/** Estado interno del reducer (lista de documentos abiertos + activo). */
interface InternalState {
  docs: OpenDocumentDTO[]
  activeId: DocumentId | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** Nivel de zoom POR documento (cada pestaña recuerda el suyo). */
  zooms: Record<DocumentId, number>
  history: Record<DocumentId, DocHistory>
}

/**
 * Límites del historial de deshacer POR DOCUMENTO. Se acota por nº de pasos y,
 * sobre todo, por memoria: los snapshots son el PDF en base64, así que en
 * documentos grandes se conservan menos pasos (pero siempre al menos uno).
 */
const HISTORY_MAX_STEPS = 30
const HISTORY_MAX_BYTES = 120 * 1024 * 1024 // ~120 MB de snapshots por documento

/** Recorta una pila de snapshots a los límites de pasos y memoria (deja ≥1). */
function trimHistory(stack: Uint8Array[]): Uint8Array[] {
  const byCount = stack.length > HISTORY_MAX_STEPS ? stack.slice(-HISTORY_MAX_STEPS) : stack
  let total = byCount.reduce((sum, s) => sum + s.length, 0)
  let start = 0
  while (total > HISTORY_MAX_BYTES && start < byCount.length - 1) {
    total -= byCount[start].length
    start += 1
  }
  return start > 0 ? byCount.slice(start) : byCount
}

/** Estado expuesto a la UI: incluye `doc` (el activo) y su `zoom` derivado. */
export interface DocumentState extends InternalState {
  doc: OpenDocumentDTO | null
  /** Zoom del documento activo (derivado de `zooms`). */
  zoom: number
}

const initialState: InternalState = {
  docs: [],
  activeId: null,
  status: 'idle',
  error: null,
  zooms: {},
  history: {}
}

type Action =
  | { type: 'LOADING' }
  | { type: 'LOADED'; doc: OpenDocumentDTO }
  | { type: 'DOC_UPDATED'; doc: OpenDocumentDTO }
  | { type: 'DOC_REPLACED'; doc: OpenDocumentDTO }
  | { type: 'ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
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
        zooms: { ...state.zooms, [action.doc.id]: 1 },
        history: { ...state.history, [action.doc.id]: { undo: [], redo: [] } }
      }
    case 'DOC_UPDATED': {
      // Guarda el estado ANTERIOR en la pila de deshacer y limpia rehacer.
      const prev = state.docs.find((d) => d.id === action.doc.id)
      const h = state.history[action.doc.id] ?? { undo: [], redo: [] }
      const undo = prev ? trimHistory([...h.undo, prev.data]) : h.undo
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.doc.id ? action.doc : d)),
        history: { ...state.history, [action.doc.id]: { undo, redo: [] } },
        status: 'ready',
        error: null
      }
    }
    case 'DOC_REPLACED':
      // Reemplaza los bytes del doc SIN tocar el historial (p. ej. al descifrar
      // un PDF protegido: es el mismo documento, no una edición que deshacer).
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.doc.id ? action.doc : d)),
        status: 'ready',
        error: null
      }
    case 'ERROR':
      return { ...state, status: 'error', error: action.message }
    case 'CLEAR_ERROR':
      return { ...state, error: null, status: state.docs.length > 0 ? 'ready' : 'idle' }
    case 'OPEN_CANCELLED':
      return { ...state, status: state.docs.length > 0 ? 'ready' : 'idle', error: null }
    case 'CLOSED': {
      const docs = state.docs.filter((d) => d.id !== action.id)
      const activeId =
        state.activeId === action.id ? (docs.length > 0 ? docs[docs.length - 1].id : null) : state.activeId
      const history = { ...state.history }
      delete history[action.id]
      const zooms = { ...state.zooms }
      delete zooms[action.id]
      return { ...state, docs, activeId, history, zooms, status: docs.length > 0 ? 'ready' : 'idle' }
    }
    case 'SET_ACTIVE':
      return { ...state, activeId: action.id }
    case 'SET_ZOOM': {
      // El zoom afecta solo al documento activo.
      if (!state.activeId) return state
      return {
        ...state,
        zooms: { ...state.zooms, [state.activeId]: clamp(action.zoom, MIN_ZOOM, MAX_ZOOM) }
      }
    }
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
      const redo = trimHistory([...h.redo, cur.data])
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
      const undo = trimHistory([...h.undo, cur.data])
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
  /** Abre el manual de usuario; con firstRun=true ofrece guardarlo al cerrarlo. */
  openManual: (path: string, firstRun?: boolean) => Promise<void>
  save: () => Promise<void>
  saveAs: () => Promise<void>
  print: () => Promise<void>
  closeDoc: (id?: DocumentId) => Promise<void>
  setActive: (id: DocumentId) => void
  setZoom: (zoom: number) => void
  /** Reemplaza el documento (por id) tras una edición. */
  applyDocUpdate: (doc: OpenDocumentDTO) => void
  /** Reemplaza el documento sin registrar en el historial (p. ej. al descifrar). */
  replaceDoc: (doc: OpenDocumentDTO) => void
  /** Muestra un error en el banner global. */
  reportError: (message: string) => void
  /** Oculta el banner de error. */
  clearError: () => void
  /**
   * Coordinador de los modos de edición (Anotar / Crear campos / Censurar).
   * `editMode` es el modo activo (o null). `requestEditMode` cambia de modo y, si
   * el actual tiene cambios sin grabar, pregunta antes (grabar/descartar/cancelar);
   * devuelve false si el usuario cancela. `exitEditMode` sale sin preguntar (tras
   * grabar). Cada modo se registra con `registerEditor` indicando si tiene cambios
   * pendientes y cómo grabarlos/descartarlos.
   */
  editMode: EditorKind | null
  requestEditMode: (mode: EditorKind | null) => Promise<boolean>
  exitEditMode: () => void
  registerEditor: (
    kind: EditorKind,
    descriptor: { hasPending: boolean; apply: () => Promise<void>; discard: () => void }
  ) => void
  /** true si el modo de edición activo tiene cambios sin grabar. */
  hasUnsavedEdits: boolean
  /** Deshacer/rehacer la última edición del documento activo. */
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

export function DocumentProvider({ children }: { children: ReactNode }): JSX.Element {
  const [internal, dispatch] = useReducer(reducer, initialState)

  // Id de la pestaña del manual abierto en la primera ejecución: al cerrarla se
  // ofrece guardarlo (solo esa vez).
  const firstRunManualRef = useRef<DocumentId | null>(null)

  // ---- Coordinador de modo de edición (Anotar / Crear campos / Censurar) -----
  // Solo un modo activo a la vez. Cada modo registra si tiene cambios sin grabar y
  // cómo grabarlos/descartarlos, para poder avisar antes de cambiar de modo, cerrar
  // la pestaña o cambiar de documento.
  const [editMode, setEditModeState] = useState<EditorKind | null>(null)
  const editorsRef = useRef<Record<EditorKind, EditorDescriptor | null>>({
    annotate: null,
    fields: null,
    redact: null
  })
  const [pendingFlags, setPendingFlags] = useState<Record<EditorKind, boolean>>({
    annotate: false,
    fields: false,
    redact: false
  })

  const registerEditor = useCallback<DocumentContextValue['registerEditor']>((kind, descriptor) => {
    editorsRef.current[kind] = { apply: descriptor.apply, discard: descriptor.discard }
    setPendingFlags((prev) =>
      prev[kind] === descriptor.hasPending ? prev : { ...prev, [kind]: descriptor.hasPending }
    )
  }, [])

  const hasUnsavedEdits = editMode != null && pendingFlags[editMode]

  const exitEditMode = useCallback(() => setEditModeState(null), [])

  const requestEditMode = useCallback<DocumentContextValue['requestEditMode']>(
    async (next) => {
      const cur = editMode
      if (cur === next) return true
      if (cur) {
        const editor = editorsRef.current[cur]
        if (pendingFlags[cur] && editor) {
          const choice = await window.api.app.confirmUnsaved({
            message: `Tienes cambios sin grabar en "${EDIT_LABELS[cur]}"`,
            detail: '¿Quieres grabarlos antes de continuar?',
            saveLabel: 'Grabar'
          })
          if (choice === 'cancel') return false
          if (choice === 'save') await editor.apply()
          else editor.discard()
        } else {
          editor?.discard()
        }
      }
      setEditModeState(next)
      return true
    },
    [editMode, pendingFlags]
  )

  // Al cambiar de documento (o pestaña), se sale del modo de edición: cada modo
  // limpia sus datos por su cuenta, así no "se cuelan" en otro documento.
  useEffect(() => {
    setEditModeState(null)
  }, [internal.activeId])

  const activeDoc = useMemo(
    () => internal.docs.find((d) => d.id === internal.activeId) ?? null,
    [internal.docs, internal.activeId]
  )
  const state: DocumentState = useMemo(
    () => ({
      ...internal,
      doc: activeDoc,
      zoom: activeDoc ? internal.zooms[activeDoc.id] ?? 1 : 1
    }),
    [internal, activeDoc]
  )

  const openDialog = useCallback(async () => {
    if (!(await requestEditMode(null))) return // protege la edición en curso
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
  }, [internal.docs, requestEditMode])

  const openByPath = useCallback(
    async (filePath: string) => {
      if (!(await requestEditMode(null))) return // protege la edición en curso
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
    [internal.docs, requestEditMode]
  )

  // Abre el manual de usuario. Si es la primera ejecución, recordamos su id para
  // ofrecer guardarlo al cerrar la pestaña (solo esa vez). No entra en recientes.
  const openManual = useCallback(
    async (path: string, firstRun = false) => {
      const existing = internal.docs.find((d) => d.filePath === path)
      if (existing) {
        dispatch({ type: 'SET_ACTIVE', id: existing.id })
        if (firstRun) firstRunManualRef.current = existing.id
        return
      }
      dispatch({ type: 'LOADING' })
      try {
        const doc = await documentClient.openPath(path)
        dispatch({ type: 'LOADED', doc })
        if (firstRun) firstRunManualRef.current = doc.id
      } catch (err) {
        handleError(err, dispatch)
      }
    },
    [internal.docs]
  )

  // Informa al main si hay cambios sin guardar (incluye edición en curso).
  const anyDirty = internal.docs.some((d) => d.isDirty) || hasUnsavedEdits
  useEffect(() => {
    window.api.app.setDirty(anyDirty)
  }, [anyDirty])

  // Graba la edición en curso (si la hay) antes de guardar/cerrar.
  const flushPending = useCallback(async () => {
    if (editMode && pendingFlags[editMode]) {
      const editor = editorsRef.current[editMode]
      if (editor) await editor.apply()
    }
  }, [editMode, pendingFlags])

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

      // Manual de la primera ejecución: al cerrarlo, ofrecemos guardarlo (esa vez).
      if (target === firstRunManualRef.current) {
        firstRunManualRef.current = null
        const choice = await window.api.app.confirmUnsaved({
          message: 'Manual de ManiPDF',
          detail: '¿Quieres guardar una copia del manual en tu equipo?',
          saveLabel: 'Guardar copia'
        })
        if (choice === 'cancel') return
        if (choice === 'save') {
          try {
            await documentClient.exportCopy(target)
          } catch (err) {
            if (err instanceof ClientError && err.isCancellation) return
          }
        }
        try {
          await documentClient.close(target)
        } finally {
          dispatch({ type: 'CLOSED', id: target })
        }
        return
      }

      // "Sucio" = cambios grabados sin guardar O edición en curso (del activo).
      const dirty = !!targetDoc?.isDirty || (isActive && hasUnsavedEdits)

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
    [activeDoc, internal.docs, hasUnsavedEdits, flushPending]
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

  const setActive = useCallback(
    async (id: DocumentId) => {
      if (id === activeDoc?.id) return
      // Si hay edición en curso en el documento actual, pregunta antes de cambiar.
      if (!(await requestEditMode(null))) return
      dispatch({ type: 'SET_ACTIVE', id })
    },
    [activeDoc?.id, requestEditMode]
  )
  const setZoom = useCallback((zoom: number) => dispatch({ type: 'SET_ZOOM', zoom }), [])
  const applyDocUpdate = useCallback((doc: OpenDocumentDTO) => dispatch({ type: 'DOC_UPDATED', doc }), [])
  const replaceDoc = useCallback((doc: OpenDocumentDTO) => dispatch({ type: 'DOC_REPLACED', doc }), [])
  const reportError = useCallback((message: string) => dispatch({ type: 'ERROR', message }), [])
  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), [])

  return (
    <DocumentContext.Provider
      value={{
        state,
        openDialog,
        openByPath,
        openManual,
        save,
        saveAs,
        print,
        closeDoc,
        setActive,
        setZoom,
        applyDocUpdate,
        replaceDoc,
        reportError,
        clearError,
        editMode,
        requestEditMode,
        exitEditMode,
        registerEditor,
        hasUnsavedEdits,
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
