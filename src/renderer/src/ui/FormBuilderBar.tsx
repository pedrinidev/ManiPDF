import type { JSX } from 'react'
import { useFormBuilder, type FieldType } from '../state/formbuilder.context'

const TYPES: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Texto' },
  { type: 'checkbox', label: 'Casilla' },
  { type: 'dropdown', label: 'Desplegable' }
]

/** Barra del modo "crear campos" (solo visible cuando está activo). */
export function FormBuilderBar(): JSX.Element | null {
  const { active, fieldType, options, fieldName, fields, busy, setFieldType, setOptions, setFieldName, exit, apply } =
    useFormBuilder()
  if (!active) return null

  return (
    <div className="formbuilder-bar">
      <span className="redact-msg">🧩 Crear campos — escribe el nombre, elige tipo y arrastra para colocar; clic en uno para quitarlo.</span>

      <div className="anno-tools">
        {TYPES.map((t) => (
          <button
            key={t.type}
            className={`btn${fieldType === t.type ? ' primary' : ''}`}
            onClick={() => setFieldType(t.type)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        className="full-input"
        style={{ maxWidth: 180 }}
        placeholder="Nombre del campo (opcional)"
        value={fieldName}
        onChange={(e) => setFieldName(e.target.value)}
      />

      {fieldType === 'dropdown' && (
        <input
          className="full-input"
          style={{ maxWidth: 220 }}
          placeholder="Opciones separadas por comas"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
        />
      )}

      <div className="redact-actions">
        <span className="anno-count">{fields.length} campo(s)</span>
        <button className="btn" onClick={exit} disabled={busy}>
          Cancelar
        </button>
        <button className="btn primary" onClick={apply} disabled={busy || fields.length === 0}>
          {busy ? 'Creando…' : 'Crear campos'}
        </button>
      </div>
    </div>
  )
}
