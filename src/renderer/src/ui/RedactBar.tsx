import type { JSX } from 'react'
import { useRedact } from '../state/redact.context'

/** Barra del modo redacción (se muestra solo cuando está activo). */
export function RedactBar(): JSX.Element | null {
  const { active, rects, busy, exit, apply } = useRedact()
  if (!active) return null

  return (
    <div className="redact-bar">
      <span className="redact-msg">
        ⬛ Censurar (ocultar datos) — arrastra para tapar zonas; clic en una para quitarla. El
        contenido tapado se elimina de forma permanente.
        <strong> {rects.length} zona(s)</strong>
      </span>
      <div className="redact-actions">
        <button className="btn" onClick={exit} disabled={busy}>
          Cancelar
        </button>
        <button className="btn primary" onClick={apply} disabled={busy || rects.length === 0}>
          {busy ? 'Aplicando…' : 'Censurar zonas'}
        </button>
      </div>
    </div>
  )
}
