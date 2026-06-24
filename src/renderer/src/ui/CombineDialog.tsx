import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { combineClient } from '../services/combine.client'
import { ClientError } from '../services/document.client'

/** Botón "Unir/Dividir" + modal para combinar varios PDF o dividir el actual. */
export function CombineDialog(): JSX.Element {
  const { state, reportError } = useDocument()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [everyN, setEveryN] = useState(1)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const close = (): void => {
    setOpen(false)
    setMessage(null)
  }

  const handleError = (err: unknown): void => {
    if (!(err instanceof ClientError && err.isCancellation)) {
      reportError(err instanceof Error ? err.message : 'Error en la operación')
    }
  }

  const merge = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const { filePath, pageCount } = await combineClient.merge()
      setMessage(`✅ PDF combinado (${pageCount} págs.) guardado en: ${filePath}`)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const split = async (): Promise<void> => {
    if (!state.doc) return
    setBusy(true)
    setMessage(null)
    try {
      const { dir, count } = await combineClient.split(state.doc.id, everyN)
      setMessage(`✅ ${count} archivo(s) creados en: ${dir}`)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Unir/Dividir
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onMouseDown={bumpModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Unir o dividir PDF</h3>

            <section className="conv-section">
              <strong>Combinar varios PDF</strong>
              <small className="conv-hint">Elige 2 o más PDF; se unirán en uno solo (en ese orden).</small>
              <button className="btn primary" onClick={merge} disabled={busy}>
                {busy ? 'Procesando…' : 'Elegir PDFs y combinar'}
              </button>
            </section>

            <section className="conv-section">
              <strong>Dividir este PDF</strong>
              {hasDoc ? (
                <>
                  <label className="inline">
                    Páginas por archivo
                    <input
                      type="number"
                      min={1}
                      value={everyN}
                      onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                      style={{ width: 64 }}
                    />
                  </label>
                  <small className="conv-hint">1 = una página por archivo. Se guardan en la carpeta que elijas.</small>
                  <button className="btn primary" onClick={split} disabled={busy}>
                    {busy ? 'Procesando…' : 'Dividir'}
                  </button>
                </>
              ) : (
                <small className="conv-hint">Abre un PDF para poder dividirlo.</small>
              )}
            </section>

            {message && <div className="modal-success">{message}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}
