import { useEffect, useRef, useState, type JSX } from 'react'
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
import logoUrl from '../assets/logo.svg'

/**
 * A partir de este nº de páginas el visor VIRTUALIZA: solo renderiza (canvas +
 * capas) las páginas cercanas a la zona visible; el resto son marcadores con
 * altura reservada. Por debajo, se renderiza todo (no compensa el coste).
 */
const VIRTUALIZE_THRESHOLD = 75

/**
 * Vista del visor: renderiza las páginas del documento activo en canvases
 * verticales. En documentos grandes virtualiza para no consumir memoria.
 */
export function Viewer(): JSX.Element {
  const { state } = useDocument()
  const { pdf, error } = usePdf()
  const { doc, zoom } = state

  // Altura estimada por página (para reservar el espacio de las no renderizadas).
  const [estHeight, setEstHeight] = useState(0)
  const virtualize = !!pdf && pdf.numPages > VIRTUALIZE_THRESHOLD

  useEffect(() => {
    if (!pdf || !virtualize) return
    let cancelled = false
    pdf
      .getPage(1)
      .then((p) => {
        if (!cancelled) setEstHeight(p.getViewport({ scale: zoom }).height)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pdf, zoom, virtualize])

  if (!doc) return <EmptyState />
  if (error) return <div className="viewer-error">⚠️ {error}</div>
  // Si ya hay un PDF (aunque se esté recargando el mismo doc), lo seguimos
  // mostrando para evitar el parpadeo en blanco; solo mostramos "Renderizando…"
  // cuando aún no hay nada que pintar.
  if (!pdf) return <div className="viewer-loading">Renderizando…</div>

  return (
    <div className="viewer">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PageCanvas
          key={i + 1}
          pdf={pdf}
          pageNumber={i + 1}
          zoom={zoom}
          virtualize={virtualize}
          estimatedHeight={estHeight || Math.round(842 * zoom)}
        />
      ))}
    </div>
  )
}

/**
 * Un canvas por página. Si `virtualize`, solo monta el canvas y las capas cuando
 * la página está cerca de la vista (IntersectionObserver); fuera de vista deja un
 * marcador con altura reservada y libera el canvas → memoria acotada.
 */
function PageCanvas({
  pdf,
  pageNumber,
  zoom,
  virtualize,
  estimatedHeight
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  zoom: number
  virtualize: boolean
  estimatedHeight: number
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(!virtualize)
  // Última altura real renderizada (para que el marcador conserve el espacio).
  const [renderedH, setRenderedH] = useState(0)

  // Observa la cercanía a la vista (con margen) para montar/desmontar.
  useEffect(() => {
    if (!virtualize) {
      setVisible(true)
      return
    }
    const wrap = wrapRef.current
    if (!wrap) return
    const root = wrap.closest('.content')
    const io = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { root: root ?? null, rootMargin: '1200px 0px' }
    )
    io.observe(wrap)
    return () => io.disconnect()
  }, [virtualize])

  // Renderiza el canvas cuando la página está visible.
  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    renderPage(pdf, pageNumber, canvas, zoom)
      .then(() => {
        if (!cancelled) setRenderedH(wrapRef.current?.offsetHeight ?? 0)
      })
      .catch(() => {
        /* error de render a nivel de página individual: se ignora */
      })
    return () => {
      cancelled = true
    }
  }, [visible, pdf, pageNumber, zoom])

  const placeholderHeight = !visible ? renderedH || estimatedHeight : undefined

  return (
    <div
      ref={wrapRef}
      className="page-wrapper"
      data-page={pageNumber}
      style={placeholderHeight ? { minHeight: placeholderHeight } : undefined}
    >
      {visible && (
        <>
          <canvas ref={canvasRef} className="page-canvas" />
          <TextSelectionLayer pdf={pdf} pageNumber={pageNumber} zoom={zoom} />
          <SearchHighlightLayer pageNumber={pageNumber} />
          <LinkLayer pageNumber={pageNumber} />
          <AnnotationLayer pageNumber={pageNumber} />
          <RedactLayer pageNumber={pageNumber} />
          <FormBuilderLayer pageNumber={pageNumber} />
          <SeparationLayer pageNumber={pageNumber} />
        </>
      )}
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
      <img className="empty-logo" src={logoUrl} alt="ManiPDF" width={96} height={96} />
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
