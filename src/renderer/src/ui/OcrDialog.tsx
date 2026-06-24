import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { ocrClient } from '../services/ocr.client'
import { renderPageForOcr } from '../services/pdf-renderer'
import { ClientError } from '../services/document.client'
import type { OcrInputPage, OcrLang } from '@shared/ipc-contract'

const OCR_SCALE = 2 // ~144 DPI: buen equilibrio precisión/velocidad

/** Botón "OCR" + modal: extraer texto o crear un PDF buscable. */
export function OcrDialog(): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()
  const { pdf } = usePdf()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<OcrLang>('spa')
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState<string | null>(null)
  // Aviso de resultado: texto + (opcional) ruta de archivo guardado para revelar.
  const [note, setNote] = useState<{ text: string; path?: string } | null>(null)

  const close = (): void => {
    setOpen(false)
    setText(null)
    setNote(null)
  }

  const handleError = (err: unknown): void => {
    if (!(err instanceof ClientError && err.isCancellation)) {
      reportError(err instanceof Error ? err.message : 'Error en el OCR')
    }
  }

  const rasterize = async (): Promise<OcrInputPage[]> => {
    if (!pdf) throw new Error('El documento aún no está listo')
    const pages: OcrInputPage[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      pages.push(await renderPageForOcr(pdf, n, OCR_SCALE))
    }
    return pages
  }

  const extract = async (): Promise<void> => {
    setBusy(true)
    setText(null)
    setNote(null)
    try {
      const pages = await rasterize()
      const result = await ocrClient.extract(lang, pages.map((p) => p.jpegBase64))
      setText(result)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const searchable = async (): Promise<void> => {
    if (!state.doc) return
    setBusy(true)
    setText(null)
    setNote(null)
    try {
      const pages = await rasterize()
      const updated = await ocrClient.searchable(state.doc.id, lang, pages)
      applyDocUpdate(updated)
      setNote({ text: '✅ PDF buscable creado (texto invisible añadido). Pulsa «Guardar» para conservarlo.' })
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  const saveText = async (): Promise<void> => {
    if (!text) return
    try {
      const filePath = await ocrClient.saveText(text)
      setNote({ text: '✅ Texto guardado en:', path: filePath })
    } catch (err) {
      handleError(err)
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasDoc}>
        OCR
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onMouseDown={bumpModal}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>OCR — Reconocer texto</h3>

            <div className="field">
              <span>Idioma</span>
              <div className="opt-res">
                <button className={`btn${lang === 'spa' ? ' primary' : ''}`} onClick={() => setLang('spa')}>
                  Español
                </button>
                <button className={`btn${lang === 'eng' ? ' primary' : ''}`} onClick={() => setLang('eng')}>
                  English
                </button>
              </div>
            </div>

            <p className="conv-hint">
              ⚠️ La primera vez se descarga el modelo del idioma (requiere internet). Puede tardar.
            </p>

            <div className="opt-res">
              <button className="btn primary" onClick={extract} disabled={busy}>
                {busy ? 'Procesando…' : 'Extraer texto'}
              </button>
              <button className="btn" onClick={searchable} disabled={busy}>
                {busy ? 'Procesando…' : 'Crear PDF buscable'}
              </button>
            </div>

            {text !== null && (
              <div className="ocr-result">
                <textarea readOnly value={text} />
                <button className="btn" onClick={saveText}>
                  Guardar como .txt
                </button>
              </div>
            )}

            {note && (
              <div className="modal-success">
                <span>{note.text}</span>
                {note.path && <code>{note.path}</code>}
                {note.path && (
                  <button className="btn" onClick={() => window.api.app.reveal(note.path!)}>
                    Mostrar en carpeta
                  </button>
                )}
              </div>
            )}

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
