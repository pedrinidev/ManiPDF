import { useEffect, useRef, type JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { renderPage, renderTextLayer } from '../services/pdf-renderer'
import { AnnotationLayer } from './AnnotationLayer'
import { SearchHighlightLayer } from './SearchHighlightLayer'
import { RedactLayer } from './RedactLayer'
import { LinkLayer } from './LinkLayer'
import { FormBuilderLayer } from './FormBuilderLayer'
import { SeparationLayer } from './SeparationLayer'
import { getRecents } from '../services/recents'

/**
 * Vista del visor: renderiza todas las páginas del documento activo en
 * canvases verticales. Reacciona al PDF compartido y al zoom del store.
 */
export function Viewer(): JSX.Element {
  const { state } = useDocument()
  const { pdf, error } = usePdf()
  const { doc, zoom } = state

  if (!doc) return <EmptyState />
  if (error) return <div className="viewer-error">⚠️ {error}</div>
  // Si ya hay un PDF (aunque se esté recargando el mismo doc), lo seguimos
  // mostrando para evitar el parpadeo en blanco; solo mostramos "Renderizando…"
  // cuando aún no hay nada que pintar.
  if (!pdf) return <div className="viewer-loading">Renderizando…</div>

  return (
    <div className="viewer">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PageCanvas key={i + 1} pdf={pdf} pageNumber={i + 1} zoom={zoom} />
      ))}
    </div>
  )
}

/** Un canvas por página; se re-renderiza al cambiar el zoom o el PDF. */
function PageCanvas({
  pdf,
  pageNumber,
  zoom
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    renderPage(pdf, pageNumber, canvas, zoom).catch(() => {
      if (!cancelled) {
        /* error de render a nivel de página individual: se ignora */
      }
    })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber, zoom])

  return (
    <div className="page-wrapper" data-page={pageNumber}>
      <canvas ref={canvasRef} className="page-canvas" />
      <TextSelectionLayer pdf={pdf} pageNumber={pageNumber} zoom={zoom} />
      <SearchHighlightLayer pageNumber={pageNumber} />
      <LinkLayer pageNumber={pageNumber} />
      <AnnotationLayer pageNumber={pageNumber} />
      <RedactLayer pageNumber={pageNumber} />
      <FormBuilderLayer pageNumber={pageNumber} />
      <SeparationLayer pageNumber={pageNumber} />
      <span className="page-number">{pageNumber}</span>
    </div>
  )
}

/** Capa de texto seleccionable (pdf.js) superpuesta a la página. */
function TextSelectionLayer({
  pdf,
  pageNumber,
  zoom
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const container = ref.current
    if (!container) return
    renderTextLayer(pdf, pageNumber, container, zoom).catch(() => {
      /* capa de texto: ignorar fallo */
    })
    return () => container.replaceChildren()
  }, [pdf, pageNumber, zoom])
  return <div ref={ref} className="textLayer" />
}

function EmptyState(): JSX.Element {
  const { openDialog, openByPath } = useDocument()
  const recents = getRecents()
  return (
    <div className="empty-state">
      <div className="empty-icon">📄</div>
      <h2>No hay ningún documento abierto</h2>
      <p>Abre un PDF o arrástralo a la ventana.</p>
      <button className="btn primary" onClick={openDialog}>
        Abrir PDF
      </button>

      {recents.length > 0 && (
        <div className="recents">
          <div className="recents-title">Recientes</div>
          {recents.map((r) => (
            <button key={r.path} className="recent-item" title={r.path} onClick={() => openByPath(r.path)}>
              📄 {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
