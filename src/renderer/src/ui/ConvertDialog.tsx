import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { convertClient } from '../services/convert.client'
import { ClientError } from '../services/document.client'
import type { ImagePageSize } from '@shared/ipc-contract'

const PAGE_SIZES: { id: ImagePageSize; label: string }[] = [
  { id: 'letter', label: 'Carta' },
  { id: 'a4', label: 'A4' },
  { id: 'image', label: 'Tamaño de la imagen' }
]
const PAGE_SIZE_KEY = 'manipdf.imagesPageSize'

/** Último tamaño elegido (comodidad de este equipo; por defecto, Carta como antes). */
function rememberedPageSize(): ImagePageSize {
  try {
    const saved = localStorage.getItem(PAGE_SIZE_KEY)
    return PAGE_SIZES.some((p) => p.id === saved) ? (saved as ImagePageSize) : 'letter'
  } catch {
    return 'letter'
  }
}

/** Crear un PDF a partir de imágenes (una página por imagen). No requiere documento abierto. */
export function ConvertDialog(): JSX.Element {
  const { reportError } = useDocument()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState<ImagePageSize>(rememberedPageSize)

  const choosePageSize = (size: ImagePageSize): void => {
    setPageSize(size)
    try {
      localStorage.setItem(PAGE_SIZE_KEY, size)
    } catch {
      /* sin almacenamiento: solo para esta vez */
    }
  }

  const close = (): void => {
    setOpen(false)
    setMessage(null)
  }

  const imagesToPdf = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const filePath = await convertClient.imagesToPdf(pageSize)
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
          <div className="modal-backdrop" onMouseDown={bumpModal}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Crear PDF desde imágenes</h3>
              <p className="conv-hint">Elige una o varias imágenes (PNG/JPG); cada una será una página.</p>
              <div className="field">
                <span>Tamaño de página</span>
                <div className="opt-res">
                  {PAGE_SIZES.map((p) => (
                    <button
                      key={p.id}
                      className={`btn${pageSize === p.id ? ' primary' : ''}`}
                      onClick={() => choosePageSize(p.id)}
                      disabled={busy}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
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
