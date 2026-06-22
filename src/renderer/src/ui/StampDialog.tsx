import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { useDocument } from '../state/document.store'
import { stampClient } from '../services/stamp.client'
import { ClientError } from '../services/document.client'
import type { HeaderFooter, StampConfig } from '@shared/ipc-contract'

const EMPTY_HF: HeaderFooter = { left: '', center: '', right: '' }

/** Botón "Marcas" + modal para marca de agua, encabezado/pie y numeración. */
export function StampDialog(): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [watermarkText, setWatermarkText] = useState('')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.2)
  const [watermarkColor, setWatermarkColor] = useState('#ff0000')
  const [watermarkDiagonal, setWatermarkDiagonal] = useState(true)
  const [header, setHeader] = useState<HeaderFooter>(EMPTY_HF)
  const [footer, setFooter] = useState<HeaderFooter>(EMPTY_HF)
  const [hfColor, setHfColor] = useState('#444444')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const close = (): void => {
    setOpen(false)
    setMessage(null)
  }

  const apply = async (): Promise<void> => {
    if (!state.doc) return
    const config: StampConfig = {
      watermarkText,
      watermarkOpacity,
      watermarkColor,
      watermarkDiagonal,
      header,
      footer,
      hfFontSize: 10,
      hfColor,
      margin: 28
    }
    setBusy(true)
    setMessage(null)
    try {
      applyDocUpdate(await stampClient.apply(state.doc.id, config))
      setMessage('✅ Aplicado. Pulsa «Guardar» en la barra para conservarlo.')
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al aplicar las marcas')
      }
    } finally {
      setBusy(false)
    }
  }

  const hfRow = (
    label: string,
    value: HeaderFooter,
    setValue: (v: HeaderFooter) => void
  ): JSX.Element => (
    <div className="hf-row">
      <span className="hf-label">{label}</span>
      <input placeholder="izq." value={value.left} onChange={(e) => setValue({ ...value, left: e.target.value })} />
      <input placeholder="centro" value={value.center} onChange={(e) => setValue({ ...value, center: e.target.value })} />
      <input placeholder="der." value={value.right} onChange={(e) => setValue({ ...value, right: e.target.value })} />
    </div>
  )

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasDoc}>
        Marcas
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onClick={close}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Marca de agua, encabezado/pie y numeración</h3>

            <section className="conv-section">
              <strong>Marca de agua</strong>
              <input
                className="full-input"
                placeholder="Texto (p. ej. CONFIDENCIAL); vacío = sin marca"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
              />
              <div className="hf-row">
                <label className="inline">
                  <input type="checkbox" checked={watermarkDiagonal} onChange={(e) => setWatermarkDiagonal(e.target.checked)} />
                  Diagonal
                </label>
                <label className="inline">
                  Color
                  <input type="color" value={watermarkColor} onChange={(e) => setWatermarkColor(e.target.value)} />
                </label>
                <label className="inline">
                  Opacidad {Math.round(watermarkOpacity * 100)}%
                  <input
                    type="range"
                    min={0.05}
                    max={0.6}
                    step={0.05}
                    value={watermarkOpacity}
                    onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                  />
                </label>
              </div>
            </section>

            <section className="conv-section">
              <strong>Encabezado y pie</strong>
              <small className="conv-hint">Placeholders: {'{page}'} {'{total}'} {'{date}'}</small>
              {hfRow('Encabezado', header, setHeader)}
              {hfRow('Pie', footer, setFooter)}
              <div className="hf-row">
                <button className="btn" onClick={() => setFooter({ ...footer, center: '{page} / {total}' })}>
                  Numeración rápida (pie centro)
                </button>
                <label className="inline">
                  Color texto
                  <input type="color" value={hfColor} onChange={(e) => setHfColor(e.target.value)} />
                </label>
              </div>
            </section>

            {message && <div className="modal-success">{message}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Cerrar
              </button>
              <button className="btn primary" onClick={apply} disabled={busy}>
                {busy ? 'Aplicando…' : 'Aplicar'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}
