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
import type { NewFormField, RectArea } from '@shared/ipc-contract'
import { useDocument } from './document.store'
import { formsClient } from '../services/forms.client'
import { ClientError } from '../services/document.client'

export type FieldType = 'text' | 'checkbox' | 'dropdown'

/** Campo colocado pendiente de crear. */
export interface PlacedField extends NewFormField {
  id: string
}

interface FormBuilderContextValue {
  active: boolean
  fieldType: FieldType
  options: string
  /** Nombre para el SIGUIENTE campo que se dibuje (opcional). */
  fieldName: string
  fields: PlacedField[]
  busy: boolean
  start: () => void
  exit: () => void
  setFieldType: (t: FieldType) => void
  setOptions: (o: string) => void
  setFieldName: (n: string) => void
  addField: (page: number, rect: RectArea) => void
  removeField: (id: string) => void
  apply: () => Promise<void>
}

const FormBuilderContext = createContext<FormBuilderContextValue | null>(null)

const LABELS: Record<FieldType, string> = { text: 'texto', checkbox: 'casilla', dropdown: 'desplegable' }

export function FormBuilderProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()

  const [active, setActive] = useState(false)
  const [fieldType, setFieldType] = useState<FieldType>('text')
  const [options, setOptions] = useState('')
  const [fieldName, setFieldName] = useState('')
  const [fields, setFields] = useState<PlacedField[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setActive(false)
    setFields([])
  }, [state.doc?.id])

  const start = useCallback(() => setActive(true), [])
  const exit = useCallback(() => {
    setActive(false)
    setFields([])
    setFieldName('')
  }, [])

  const addField = useCallback(
    (page: number, rect: RectArea) => {
      setFields((prev) => {
        // Nombre escrito por el usuario o, si está vacío, uno automático.
        const base =
          fieldName.trim() || `${LABELS[fieldType]}_${prev.filter((f) => f.type === fieldType).length + 1}`
        // Garantiza que el nombre sea único entre los campos colocados.
        let name = base
        let n = 2
        while (prev.some((f) => f.name === name)) name = `${base}_${n++}`
        const opts = fieldType === 'dropdown' ? splitOptions(options) : []
        return [...prev, { id: crypto.randomUUID(), type: fieldType, name, page, rect, options: opts }]
      })
      setFieldName('') // listo para el siguiente campo
    },
    [fieldType, options, fieldName]
  )

  const removeField = useCallback((id: string) => setFields((prev) => prev.filter((f) => f.id !== id)), [])

  const apply = useCallback(async () => {
    if (!state.doc || fields.length === 0) return
    setBusy(true)
    try {
      const payload: NewFormField[] = fields.map(({ id, ...f }) => {
        void id
        return f
      })
      applyDocUpdate(await formsClient.create(state.doc.id, payload))
      setActive(false)
      setFields([])
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al crear los campos')
      }
    } finally {
      setBusy(false)
    }
  }, [state.doc, fields, applyDocUpdate, reportError])

  const value = useMemo(
    () => ({
      active,
      fieldType,
      options,
      fieldName,
      fields,
      busy,
      start,
      exit,
      setFieldType,
      setOptions,
      setFieldName,
      addField,
      removeField,
      apply
    }),
    [active, fieldType, options, fieldName, fields, busy, start, exit, addField, removeField, apply]
  )

  return <FormBuilderContext.Provider value={value}>{children}</FormBuilderContext.Provider>
}

function splitOptions(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function useFormBuilder(): FormBuilderContextValue {
  const ctx = useContext(FormBuilderContext)
  if (!ctx) throw new Error('useFormBuilder debe usarse dentro de <FormBuilderProvider>')
  return ctx
}
