import { type JSX } from 'react'
import { useSeparations } from '../state/separations.context'
import { inkInfo } from '../services/separation-utils'
import type { SeparationMode } from '@shared/ipc-contract'

const MODES: { id: SeparationMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'cmyk', label: 'CMYK' },
  { id: 'rgb', label: 'RGB' }
]

/** Panel lateral del modo separación: espacio, tintas (checks), vista, exportar, salir. */
export function SeparationPanel(): JSX.Element | null {
  const { active, enabled, inkNames, busy, grayView, mode, space, toggle, toggleGrayView, setMode, exportAll, exportGrayPdf, exit } =
    useSeparations()
  if (!active) return null

  return (
    <aside className="sep-panel">
      <div className="panel-title">Separación de colores</div>

      <div className="sep-panel-body">
        <div className="sep-field">
          <span>Espacio de color {mode === 'auto' && space && `· detectado: ${space.toUpperCase()}`}</span>
          <div className="opt-res">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`btn${mode === m.id ? ' primary' : ''}`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sep-field">
          <span>Tintas {busy && '· separando…'}</span>
          <div className="sep-ink-list">
            {inkNames.length === 0 && <small className="conv-hint">Generando planchas…</small>}
            {inkNames.map((name) => {
              const info = inkInfo(name)
              return (
                <label key={name} className="sep-ink">
                  <input type="checkbox" checked={enabled.has(name)} onChange={() => toggle(name)} />
                  <span className="sep-swatch" style={{ background: info.swatch }} />
                  {name}
                </label>
              )
            })}
          </div>
        </div>

        <label className="sep-ink">
          <input type="checkbox" checked={grayView} onChange={toggleGrayView} />
          Ver en gris (planchas/film)
        </label>

        <small className="conv-hint">
          Con todas las tintas marcadas ves el documento en color (como Illustrator). Para revisar una
          plancha: desmarca el resto. Activa «Ver en gris» para verlas en negro sobre blanco, como en
          film/CTP. Las tintas planas se aproximan (color real desconocido).
        </small>

        <small className="conv-hint">
          «Auto» separa en el espacio original del documento: CMYK → C/M/Y/K, RGB → R/G/B (sin forzar a
          CMYK, que distorsiona). Solo se listan los canales con contenido real (un PDF a 1 tinta negra
          muestra solo «Black»). Las tintas planas se aplanan a CMYK.
        </small>

        <div className="sep-field">
          <span>Exportar</span>
          <button className="btn" onClick={exportAll} disabled={inkNames.length === 0}>
            Planchas (PNG)
          </button>
          <button className="btn" onClick={exportGrayPdf}>
            Documento en grises (PDF)
          </button>
        </div>
      </div>

      <div className="sep-panel-actions">
        <button className="btn primary" onClick={exit}>
          Salir
        </button>
      </div>
    </aside>
  )
}
