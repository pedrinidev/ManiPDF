import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { formsClient } from '../services/forms.client'
import { ClientError } from '../services/document.client'
import type { FormFieldDTO, FormFieldValue } from '@shared/ipc-contract'

type FieldValues = Record<string, string | boolean>

/** Botón "Formulario" + modal para detectar y rellenar campos del PDF. */
export function FormsDialog(): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()
  const hasDoc = !!state.doc && !state.doc.readOnly

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fields, setFields] = useState<FormFieldDTO[]>([])
  const [values, setValues] = useState<FieldValues>({})
  const [flatten, setFlatten] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const openDialog = async (): Promise<void> => {
    if (!state.doc) return
    setOpen(true)
    setMessage(null)
    setLoading(true)
    try {
      const list = await formsClient.list(state.doc.id)
      setFields(list)
      setValues(initialValues(list))
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Error al leer el formulario')
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }

  const close = (): void => {
    setOpen(false)
    setMessage(null)
  }

  const set = (name: string, value: string | boolean): void =>
    setValues((prev) => ({ ...prev, [name]: value }))

  const submit = async (): Promise<void> => {
    if (!state.doc) return
    const payload: FormFieldValue[] = fields
      .filter((f) => !f.readOnly)
      .map((f) => ({ name: f.name, value: values[f.name] ?? '' }))

    setBusy(true)
    setMessage(null)
    try {
      const updated = await formsClient.fill(state.doc.id, payload, flatten)
      applyDocUpdate(updated)
      setMessage(
        flatten
          ? '✅ Formulario rellenado y aplanado. Pulsa «Guardar» para conservarlo.'
          : '✅ Formulario rellenado. Pulsa «Guardar» para conservarlo.'
      )
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al rellenar el formulario')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn" onClick={openDialog} disabled={!hasDoc}>
        Formulario
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onMouseDown={bumpModal}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Campos de formulario</h3>

            {loading ? (
              <p className="conv-hint">Leyendo campos…</p>
            ) : fields.length === 0 ? (
              <p className="conv-hint">Este PDF no tiene campos de formulario.</p>
            ) : (
              <div className="forms-list">
                {fields.map((f) => (
                  <FieldRow key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
                ))}
              </div>
            )}

            {message && <div className="modal-success">{message}</div>}

            <div className="modal-actions">
              {fields.length > 0 && (
                <label className="flatten-check">
                  <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
                  Aplanar (no editable)
                </label>
              )}
              <button className="btn" onClick={close}>
                Cerrar
              </button>
              {fields.length > 0 && (
                <button className="btn primary" onClick={submit} disabled={busy}>
                  {busy ? 'Aplicando…' : 'Rellenar'}
                </button>
              )}
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}

function FieldRow({
  field,
  value,
  onChange
}: {
  field: FormFieldDTO
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
}): JSX.Element {
  return (
    <label className="form-field">
      <span className="form-field-name" title={`${field.name} · ${field.type}`}>
        {field.name}
      </span>
      <FieldControl field={field} value={value} onChange={onChange} />
    </label>
  )
}

function FieldControl({
  field,
  value,
  onChange
}: {
  field: FormFieldDTO
  value: string | boolean | undefined
  onChange: (value: string | boolean) => void
}): JSX.Element {
  if (field.readOnly) {
    return <span className="form-readonly">({field.type})</span>
  }
  if (field.type === 'checkbox') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
  }
  if (field.type === 'radio' || field.type === 'dropdown' || field.type === 'optionlist') {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }
  return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
}

function initialValues(fields: FormFieldDTO[]): FieldValues {
  const out: FieldValues = {}
  for (const f of fields) {
    out[f.name] = f.type === 'checkbox' ? f.checked : f.value
  }
  return out
}
