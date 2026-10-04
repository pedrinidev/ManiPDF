import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { optimizeClient } from '../services/optimize.client'
import { renderPageToJpeg } from '../services/pdf-renderer'
import { ClientError } from '../services/document.client'
import type { RasterPage } from '@shared/ipc-contract'

type Mode = 'structure' | 'raster'

const RESOLUTIONS: { label: string; scale: number }[] = [
  { label: 'Alta', scale: 2 },
  { label: 'Media', scale: 1.5 },
  { label: 'Baja', scale: 1 }
]

/** Botón "Comprimir" + modal con los dos modos de optimización. */
export function OptimizeDialog(): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()
  const { pdf, revision } = usePdf()
  const hasDoc = !!state.doc && !state.doc.readOnly

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('structure')
  const [scale, setScale] = useState(1.5)
  const [quality, setQuality] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ before: number; after: number } | null>(null)

  const close = (): void => {
    setOpen(false)
    setResult(null)
  }

  const run = async (): Promise<void> => {
    if (!state.doc) return
    const before = state.doc.data.byteLength
    // La revisión de lo que se va a rasterizar (la que muestra el visor), no la del
    // store: justo tras una edición, el visor aún puede tener la versión anterior.
    const baseRevision = revision ?? -1
    setBusy(true)
    setResult(null)
    try {
      const updated =
        mode === 'structure'
          ? await optimizeClient.lossless(state.doc.id)
          : await optimizeClient.rebuildFromImages(state.doc.id, await rasterizeAll(), baseRevision)
      applyDocUpdate(updated)
      setResult({ before, after: updated.data.byteLength })
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al comprimir')
      }
    } finally {
      setBusy(false)
    }
  }

  /** Rasteriza todas las páginas a JPEG usando el pdf.js compartido. */
  const rasterizeAll = async (): Promise<RasterPage[]> => {
    if (!pdf) throw new Error('El documento aún no está listo para rasterizar')
    const pages: RasterPage[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      pages.push(await renderPageToJpeg(pdf, n, scale, quality))
    }
    return pages
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasDoc}>
        Comprimir
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onMouseDown={bumpModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Comprimir PDF</h3>

            <div className="opt-modes">
              <label className={`opt-mode${mode === 'structure' ? ' active' : ''}`}>
                <input type="radio" checked={mode === 'structure'} onChange={() => setMode('structure')} />
                <div>
                  <strong>Estructura (sin pérdida)</strong>
                  <small>Mantiene texto e imágenes. Ganancia modesta.</small>
                </div>
              </label>
              <label className={`opt-mode${mode === 'raster' ? ' active' : ''}`}>
                <input type="radio" checked={mode === 'raster'} onChange={() => setMode('raster')} />
                <div>
                  <strong>Rasterizar (con pérdida)</strong>
                  <small>Convierte páginas a imagen. Reduce mucho, pero el texto deja de ser seleccionable.</small>
                </div>
              </label>
            </div>

            {mode === 'raster' && (
              <div className="opt-raster">
                <div className="field">
                  <span>Resolución</span>
                  <div className="opt-res">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r.scale}
                        className={`btn${scale === r.scale ? ' primary' : ''}`}
                        onClick={() => setScale(r.scale)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field">
                  <span>Calidad JPEG: {Math.round(quality * 100)}%</span>
                  <input
                    type="range"
                    min={0.3}
                    max={0.9}
                    step={0.05}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                </label>
              </div>
            )}

            {result && (
              <div className="modal-success">
                {result.after < result.before ? '✅' : 'ℹ️'} {formatSize(result.before)} →{' '}
                {formatSize(result.after)}{' '}
                <strong>
                  ({result.after < result.before
                    ? `−${Math.round((1 - result.after / result.before) * 100)}%`
                    : 'sin reducción'}
                  )
                </strong>
                <small>Pulsa «Guardar» en la barra para conservar el resultado en disco.</small>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Cerrar
              </button>
              <button className="btn primary" onClick={run} disabled={busy}>
                {busy ? 'Comprimiendo…' : 'Comprimir'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
