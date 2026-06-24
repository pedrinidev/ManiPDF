import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { convertClient } from '../services/convert.client'
import { separationsClient } from '../services/separations.client'
import { ocrClient } from '../services/ocr.client'
import { renderPageToImage, extractPageLines } from '../services/pdf-renderer'
import { ClientError, documentClient } from '../services/document.client'
import type { InkCoverage } from '@shared/ipc-contract'

/** Mensaje de verificación de tinta: confirma "solo negro" o avisa de C/M/Y. */
function inkNote(ink: InkCoverage | null): string | undefined {
  if (!ink) return undefined
  const pct = (v: number): number => Math.round(v * 100)
  const color = ink.c + ink.m + ink.y
  if (color < 0.005) {
    return `✔ Verificado: solo tinta negra (K=${pct(ink.k)}%). C/M/Y = 0% → 1 sola plancha en imprenta.`
  }
  return `⚠ Aún queda color: C=${pct(ink.c)}% M=${pct(ink.m)}% Y=${pct(ink.y)}% K=${pct(ink.k)}%.`
}

type Format = 'pdf' | 'png' | 'jpg' | 'gray' | 'txt'

const FORMATS: { id: Format; label: string; desc: string }[] = [
  { id: 'pdf', label: 'PDF (copia)', desc: 'Copia del documento con los cambios aplicados, en color' },
  { id: 'png', label: 'Imágenes PNG', desc: 'Una imagen por página (sin pérdida)' },
  { id: 'jpg', label: 'Imágenes JPG', desc: 'Una imagen por página (más ligero)' },
  {
    id: 'gray',
    label: 'PDF en escala de grises',
    desc: 'Una sola tinta negra (canal K). Vectorial, texto seleccionable, sin perder calidad'
  },
  { id: 'txt', label: 'Texto (.txt)', desc: 'Extrae el texto del documento a un archivo' }
]

// Una página PDF es vectorial: no tiene "resolución" fija. Al exportar a imagen
// hay que rasterizar a una densidad concreta (ppp/dpi). 300 = calidad de
// impresión; 600 = máxima (artes gráficas). El visor pdf.js usa "scale" donde
// scale 1 = 72 ppp, así que scale = ppp / 72.
const PPP_BASE = 72
const RESOLUTIONS = [
  { label: '150 ppp · pantalla', dpi: 150 },
  { label: '300 ppp · impresión', dpi: 300 },
  { label: '600 ppp · máxima', dpi: 600 }
]

/** Exportar el documento a otros formatos (imágenes, grises, texto). */
export function ExportDialog(): JSX.Element {
  const { state, reportError } = useDocument()
  const { pdf } = usePdf()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<Format>('png')
  const [dpi, setDpi] = useState(300)
  const [busy, setBusy] = useState(false)
  /** Resultado de la última exportación: texto + ruta + nota de verificación. */
  const [result, setResult] = useState<{ text: string; path: string; note?: string } | null>(null)

  const close = (): void => {
    setOpen(false)
    setResult(null)
  }

  // Al cambiar de formato, el resultado anterior deja de ser relevante.
  const selectFormat = (f: Format): void => {
    setFormat(f)
    setResult(null)
  }

  const run = async (): Promise<void> => {
    if (!state.doc || !pdf) return
    setBusy(true)
    setResult(null)
    try {
      if (format === 'pdf') {
        const filePath = await documentClient.exportCopy(state.doc.id)
        setResult({ text: 'PDF guardado en:', path: filePath })
      } else if (format === 'png' || format === 'jpg') {
        const images: string[] = []
        const scale = dpi / PPP_BASE
        for (let n = 1; n <= pdf.numPages; n++) {
          images.push(await renderPageToImage(pdf, n, scale, format))
        }
        const { dir, count } = await convertClient.exportImages(format, images)
        setResult({ text: `${count} imagen(es) ${format.toUpperCase()} guardadas en:`, path: dir })
      } else if (format === 'gray') {
        const { filePath, ink } = await separationsClient.exportGray(state.doc.id)
        setResult({ text: 'PDF en escala de grises guardado en:', path: filePath, note: inkNote(ink) })
      } else {
        let text = ''
        for (let n = 1; n <= pdf.numPages; n++) {
          const lines = await extractPageLines(pdf, n)
          text += `--- Página ${n} ---\n${lines.join('\n')}\n\n`
        }
        const filePath = await ocrClient.saveText(text)
        setResult({ text: 'Texto guardado en:', path: filePath })
      }
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al exportar')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasDoc}>
        Exportar…
      </button>

      {open && (
        <Portal>
          <div className="modal-backdrop" onMouseDown={bumpModal}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Exportar a otro formato</h3>

              <div className="opt-modes">
                {FORMATS.map((f) => (
                  <label key={f.id} className={`opt-mode${format === f.id ? ' active' : ''}`}>
                    <input type="radio" checked={format === f.id} onChange={() => selectFormat(f.id)} />
                    <div>
                      <strong>{f.label}</strong>
                      <small>{f.desc}</small>
                    </div>
                  </label>
                ))}
              </div>

              {(format === 'png' || format === 'jpg') && (
                <div className="field">
                  <span>Resolución de salida (ppp)</span>
                  <div className="opt-res">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r.dpi}
                        className={`btn${dpi === r.dpi ? ' primary' : ''}`}
                        onClick={() => setDpi(r.dpi)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <small className="conv-hint">
                    El PDF es vectorial (sin resolución fija); al pasar a imagen se rasteriza a esta
                    densidad. 300 ppp = calidad de impresión.
                  </small>
                </div>
              )}

              {format === 'gray' && (
                <p className="conv-hint">
                  Convierte todo a una sola tinta negra (canal K) sin rasterizar: el TEXTO sigue
                  seleccionable y no se pierde calidad. En imprenta sale en 1 plancha (no CMYK). Al
                  abrirlo y separarlo verás solo «Black». Tras exportar se verifica con Ghostscript que
                  C/M/Y quedan a 0%. Requiere Ghostscript.
                </p>
              )}

              <p className="conv-hint">
                Para Word/Excel no hay soporte (requiere motores externos). Sí: imágenes, grises y texto.
              </p>

              {result && (
                <div className="modal-success">
                  <span>✅ {result.text}</span>
                  <code>{result.path}</code>
                  {result.note && <span>{result.note}</span>}
                  <button className="btn" onClick={() => window.api.app.reveal(result.path)}>
                    📂 Mostrar en carpeta
                  </button>
                </div>
              )}

              <div className="modal-actions">
                <button className="btn" onClick={close}>
                  {result ? 'Listo' : 'Cerrar'}
                </button>
                <button className="btn primary" onClick={run} disabled={busy}>
                  {busy ? 'Exportando…' : result ? 'Exportar de nuevo' : 'Exportar'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
