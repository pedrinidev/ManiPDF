import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { compareClient } from '../services/compare.client'
import { loadPdf, extractPageLines } from '../services/pdf-renderer'
import { lineDiff, type DiffOp } from '../services/diff'
import { ClientError } from '../services/document.client'

interface PageDiff {
  page: number
  added: number
  removed: number
  ops: DiffOp[]
}

/** Botón "Comparar" + modal que muestra las diferencias de texto con otro PDF. */
export function CompareDialog(): JSX.Element {
  const { state, reportError } = useDocument()
  const { pdf } = usePdf()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [otherName, setOtherName] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<PageDiff[] | null>(null)

  const close = (): void => {
    setOpen(false)
    setDiffs(null)
    setOtherName(null)
  }

  const run = async (): Promise<void> => {
    if (!pdf) return
    setBusy(true)
    setDiffs(null)
    let other: PDFDocumentProxy | null = null
    try {
      const picked = await compareClient.pick()
      setOtherName(picked.fileName)
      other = await loadPdf(picked.dataBase64)
      setDiffs(await comparePdfs(pdf, other))
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al comparar')
      }
    } finally {
      other?.destroy()
      setBusy(false)
    }
  }

  const changed = diffs?.filter((d) => d.added > 0 || d.removed > 0) ?? []
  const totalAdded = changed.reduce((s, d) => s + d.added, 0)
  const totalRemoved = changed.reduce((s, d) => s + d.removed, 0)

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasDoc}>
        Comparar
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onClick={close}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Comparar con otro PDF</h3>

            <p className="conv-hint">
              Compara el texto del documento actual con otro PDF, página a página.
            </p>
            <button className="btn primary" onClick={run} disabled={busy}>
              {busy ? 'Comparando…' : 'Elegir PDF y comparar'}
            </button>

            {diffs && (
              <div className="cmp-result">
                <div className="modal-success">
                  {changed.length === 0
                    ? `✅ Sin diferencias de texto frente a «${otherName}».`
                    : `${changed.length} página(s) con cambios frente a «${otherName}» — `}
                  {changed.length > 0 && (
                    <strong>
                      <span className="cmp-add">+{totalAdded}</span>{' '}
                      <span className="cmp-del">−{totalRemoved}</span> líneas
                    </strong>
                  )}
                </div>

                <div className="cmp-pages">
                  {changed.map((d) => (
                    <div key={d.page} className="cmp-page">
                      <div className="cmp-page-head">
                        Página {d.page} <span className="cmp-add">+{d.added}</span>{' '}
                        <span className="cmp-del">−{d.removed}</span>
                      </div>
                      {d.ops
                        .filter((op) => op.type !== 'same')
                        .map((op, i) => (
                          <div key={i} className={`cmp-line ${op.type}`}>
                            {op.type === 'add' ? '+ ' : '− '}
                            {op.text}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
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

async function comparePdfs(a: PDFDocumentProxy, b: PDFDocumentProxy): Promise<PageDiff[]> {
  const maxPages = Math.max(a.numPages, b.numPages)
  const result: PageDiff[] = []
  for (let p = 1; p <= maxPages; p++) {
    const linesA = p <= a.numPages ? await extractPageLines(a, p) : []
    const linesB = p <= b.numPages ? await extractPageLines(b, p) : []
    const ops = lineDiff(linesA, linesB)
    result.push({
      page: p,
      added: ops.filter((o) => o.type === 'add').length,
      removed: ops.filter((o) => o.type === 'del').length,
      ops
    })
  }
  return result
}
