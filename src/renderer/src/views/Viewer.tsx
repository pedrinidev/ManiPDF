import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import {
  renderPage,
  renderTextLayer,
  isRenderCancelled,
  type PageSize
} from '../services/pdf-renderer'
import { AnnotationLayer } from './AnnotationLayer'
import { SearchHighlightLayer } from './SearchHighlightLayer'
import { RedactLayer } from './RedactLayer'
import { LinkLayer } from './LinkLayer'
import { FormBuilderLayer } from './FormBuilderLayer'
import { SeparationLayer } from './SeparationLayer'
import { getRecents, pruneMissingRecents, type RecentDoc } from '../services/recents'
import logoUrl from '../assets/logo.svg'

/**
 * Margen (px) alrededor de la zona visible en el que las páginas se mantienen
 * pintadas. Fuera de él se liberan canvas y capas, así la memoria queda acotada
 * sea cual sea el zoom o el nº de páginas (al 400 % en una pantalla Retina, una
 * página carta ocupa ~120 MB de canvas).
 */
const RENDER_MARGIN_PX = 1500

/**
 * Vista del visor: las páginas del documento activo en vertical. Cada página
 * ocupa desde el principio su tamaño exacto (pageSizes × zoom), aunque aún no se
 * haya pintado, y solo se pintan las cercanas a la zona visible.
 */
export function Viewer(): JSX.Element {
  const { state } = useDocument()
  const { pdf, pageSizes, error, needsPassword, passwordError, submitPassword } = usePdf()
  const { doc, zoom } = state
  const dpr = useDevicePixelRatio()

  if (!doc) return <EmptyState />
  if (needsPassword) return <PasswordPrompt error={passwordError} onSubmit={submitPassword} />
  if (error) return <div className="viewer-error">⚠️ {error}</div>
  // Si ya hay un PDF (aunque se esté recargando el mismo doc), lo seguimos
  // mostrando para evitar el parpadeo en blanco; solo mostramos "Renderizando…"
  // cuando aún no hay nada que pintar.
  if (!pdf || !pageSizes) return <div className="viewer-loading">Renderizando…</div>

  return (
    <div className="viewer">
      {pageSizes.map((size, i) => (
        <PageCanvas key={i + 1} pdf={pdf} pageNumber={i + 1} size={size} zoom={zoom} dpr={dpr} />
      ))}
    </div>
  )
}

/** Densidad de la pantalla: cambia al mover la ventana entre un monitor normal y uno Retina. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = (): void => setDpr(window.devicePixelRatio || 1)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [dpr])
  return dpr
}

/**
 * Una página. Solo monta el canvas y las capas cuando está cerca de la vista
 * (IntersectionObserver); fuera de ella queda el hueco con su tamaño exacto.
 */
function PageCanvas({
  pdf,
  pageNumber,
  size,
  zoom,
  dpr
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  size: PageSize
  zoom: number
  dpr: number
}): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Las primeras páginas se pintan sin esperar al observador (sin parpadeo al abrir).
  const [visible, setVisible] = useState(pageNumber <= 2)

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const io = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { root: wrap.closest('.content'), rootMargin: `${RENDER_MARGIN_PX}px 0px` }
    )
    io.observe(wrap)
    return () => io.disconnect()
  }, [])

  // Pinta la página cuando está cerca de la vista; un zoom (o una recarga) nuevo
  // cancela el render anterior en vez de pisarlo. `dpr` vuelve a pintar a la
  // densidad de la pantalla actual.
  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    const job = renderPage(pdf, pageNumber, canvas, zoom)
    job.promise.catch((err) => {
      if (!isRenderCancelled(err)) console.warn(`No se pudo pintar la página ${pageNumber}:`, err)
    })
    return () => job.cancel()
  }, [visible, pdf, pageNumber, zoom, dpr])

  return (
    <div
      ref={wrapRef}
      className="page-wrapper"
      data-page={pageNumber}
      style={{ width: size.width * zoom, height: size.height * zoom }}
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
    const job = renderTextLayer(pdf, pageNumber, container, zoom)
    job.promise.catch((err) => {
      if (!isRenderCancelled(err)) console.warn(`Capa de texto de la página ${pageNumber}:`, err)
    })
    return () => {
      job.cancel()
      container.replaceChildren()
    }
  }, [pdf, pageNumber, zoom])
  return <div ref={ref} className="textLayer" />
}

/** Pantalla para introducir la contraseña de un PDF cifrado. */
function PasswordPrompt({
  error,
  onSubmit
}: {
  error: string | null
  onSubmit: (password: string) => void
}): JSX.Element {
  const [password, setPassword] = useState('')
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (password) onSubmit(password)
  }
  return (
    <div className="empty-state">
      <img className="empty-logo" src={logoUrl} alt="ManiPDF" width={72} height={72} />
      <h2>Documento protegido</h2>
      <p>Este PDF está cifrado. Introduce la contraseña para abrirlo.</p>
      <form className="password-form" onSubmit={submit}>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
        />
        <button type="submit" className="btn primary" disabled={!password}>
          Abrir
        </button>
      </form>
      {error && <p className="password-error">{error}</p>}
    </div>
  )
}

function EmptyState(): JSX.Element {
  const { openDialog, openByPath } = useDocument()
  const [recents, setRecents] = useState<RecentDoc[]>(getRecents)
  // Oculta los recientes que ya no existen (movidos o borrados).
  useEffect(() => {
    let alive = true
    pruneMissingRecents()
      .then((kept) => alive && setRecents(kept))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
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
