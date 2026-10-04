import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { ocrClient } from '../services/ocr.client'
import { pagesNeedingOcr, renderPageForOcr } from '../services/pdf-renderer'
import { ClientError } from '../services/document.client'
import type { OcrInputPage, OcrLang } from '@shared/ipc-contract'

const OCR_SCALE = 2 // ~144 DPI: buen equilibrio precisión/velocidad

/** Botón "OCR" + modal: extraer texto o crear un PDF buscable. */
export function OcrDialog(): JSX.Element {
  const { state, applyDocUpdate, reportError } = useDocument()
  const { pdf, revision } = usePdf()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<OcrLang>('spa')
  const [busy, setBusy] = useState(false)
  // Qué se está haciendo mientras `busy` (el OCR de muchas páginas tarda minutos).
  const [progress, setProgress] = useState<string | null>(null)
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

  const rasterize = async (pageNumbers: number[]): Promise<OcrInputPage[]> => {
    if (!pdf) throw new Error('El documento aún no está listo')
    const pages: OcrInputPage[] = []
    for (const n of pageNumbers) {
      setProgress(`Preparando página ${pages.length + 1} de ${pageNumbers.length}…`)
      pages.push(await renderPageForOcr(pdf, n, OCR_SCALE))
    }
    setProgress(`Reconociendo el texto de ${pageNumbers.length === 1 ? '1 página' : `${pageNumbers.length} páginas`}…`)
    return pages
  }

  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setText(null)
    setNote(null)
    try {
      await task()
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const extract = (): Promise<void> =>
    run(async () => {
      if (!pdf) throw new Error('El documento aún no está listo')
      const all = Array.from({ length: pdf.numPages }, (_, i) => i + 1)
      const pages = await rasterize(all)
      setText(await ocrClient.extract(lang, pages.map((p) => p.jpegBase64)))
    })

  const searchable = (): Promise<void> =>
    run(async () => {
      if (!state.doc || !pdf || revision === null) throw new Error('El documento aún no está listo')
      // La revisión de lo que se va a rasterizar (la que muestra el visor).
      const baseRevision = revision
      // Solo las páginas sin texto (escaneadas): el resto ya es buscable y no se toca.
      setProgress('Buscando páginas sin texto…')
      const targets = await pagesNeedingOcr(pdf)
      if (targets.length === 0) {
        setNote({ text: 'ℹ️ Todas las páginas ya tienen texto: el PDF ya es buscable.' })
        return
      }
      const pages = await rasterize(targets)
      const updated = await ocrClient.searchable(state.doc.id, lang, pages, baseRevision)
      applyDocUpdate(updated)
      const scope =
        targets.length === pdf.numPages
          ? 'todas las páginas'
          : `${targets.length} de ${pdf.numPages} páginas (las que no tenían texto)`
      setNote({ text: `✅ Texto invisible añadido en ${scope}. Pulsa «Guardar» para conservarlo.` })
    })

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
            <p className="conv-hint">
              «Crear PDF buscable» añade texto invisible solo en las páginas escaneadas (sin texto); el
              contenido original de todas las páginas se conserva.
            </p>

            <div className="opt-res">
              <button className="btn primary" onClick={extract} disabled={busy}>
                {busy ? 'Procesando…' : 'Extraer texto'}
              </button>
              <button
                className="btn"
                onClick={searchable}
                disabled={busy || !!state.doc?.readOnly}
                title={state.doc?.readOnly ? 'Este PDF protegido no se puede modificar' : undefined}
              >
                {busy ? 'Procesando…' : 'Crear PDF buscable'}
              </button>
            </div>

            {busy && progress && <p className="conv-hint" role="status">{progress}</p>}

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
