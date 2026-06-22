import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { useDocument } from '../state/document.store'
import { convertClient } from '../services/convert.client'
import { ClientError } from '../services/document.client'

/** Crear un PDF a partir de imágenes (una página por imagen). No requiere documento abierto. */
export function ConvertDialog(): JSX.Element {
  const { reportError } = useDocument()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const close = (): void => {
    setOpen(false)
    setMessage(null)
  }

  const imagesToPdf = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const filePath = await convertClient.imagesToPdf()
      setMessage(`✅ PDF creado en: ${filePath}`)
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al crear el PDF')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        Crear PDF desde imágenes…
      </button>

      {open && (
        <Portal>
          <div className="modal-backdrop" onClick={close}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Crear PDF desde imágenes</h3>
              <p className="conv-hint">Elige una o varias imágenes (PNG/JPG); cada una será una página.</p>
              <button className="btn primary" onClick={imagesToPdf} disabled={busy}>
                {busy ? 'Creando…' : 'Elegir imágenes y crear PDF'}
              </button>
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
