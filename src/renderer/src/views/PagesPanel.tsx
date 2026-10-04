import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { usePages } from '../state/pages.context'
import { useNavigation } from '../state/navigation.context'
import { renderThumbnail, isRenderCancelled } from '../services/pdf-renderer'
import { scrollIntoViewWithin } from '../services/navigate'
import { dropSide } from '../services/page-order'
import { Icon, type IconName } from '../ui/Icon'

const THUMB_WIDTH = 110
const PANEL_WIDTH = 200

const ACTIONS: { id: string; icon: IconName; label: string }[] = [
  { id: 'rotL', icon: 'rotate-left', label: 'Izquierda' },
  { id: 'rotR', icon: 'rotate-right', label: 'Derecha' },
  { id: 'dup', icon: 'copy', label: 'Duplicar' },
  { id: 'extract', icon: 'extract', label: 'Extraer' },
  { id: 'insert', icon: 'insert', label: 'Insertar' },
  { id: 'delete', icon: 'trash', label: 'Borrar' }
]

/**
 * Panel derecho de páginas: acciones (con icono + etiqueta) y miniaturas.
 * Se muestra/oculta con una pestaña FLOTANTE pegada al borde derecho.
 *
 * Clic en una miniatura → el visor va a esa página (y queda seleccionada para las
 * acciones). Mayús/Cmd/Ctrl + clic solo amplían la selección, sin saltar. La
 * miniatura de la página que se está viendo se resalta y la lista la sigue.
 */
export function PagesPanel(): JSX.Element | null {
  const { state, undo, redo, canUndo, canRedo } = useDocument()
  const { pdf } = usePdf()
  const { selected, select, reorder, hasSelection, busy, rotate, remove, duplicate, extract, insert } =
    usePages()
  const { currentPage, goToPage } = useNavigation()
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(true)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const doc = state.doc

  // La lista acompaña al visor: si la página actual queda fuera de la vista del
  // panel, se desplaza (solo el panel) lo justo para mostrarla.
  useEffect(() => {
    const list = listRef.current
    const thumb = list?.querySelector<HTMLElement>(`.thumb[data-index="${currentPage - 1}"]`)
    if (list && thumb) scrollIntoViewWithin(list, thumb)
  }, [currentPage, open])

  if (!doc) return null

  const onThumbClick = (index: number, e: MouseEvent): void => {
    const extend = e.shiftKey || e.ctrlKey || e.metaKey
    select(index, { shift: e.shiftKey, meta: e.ctrlKey || e.metaKey })
    if (!extend) goToPage(index + 1)
  }

  const onDrop = (target: number): void => {
    setDropIndex(null)
    if (dragIndex !== null && dragIndex !== target) reorder(dragIndex, target)
    setDragIndex(null)
  }

  const run = (id: (typeof ACTIONS)[number]['id']): void => {
    if (id === 'rotL') rotate(-90)
    else if (id === 'rotR') rotate(90)
    else if (id === 'dup') duplicate()
    else if (id === 'extract') extract()
    else if (id === 'insert') insert()
    else if (id === 'delete') remove()
  }

  const readOnly = !!doc.readOnly
  const isDisabled = (id: (typeof ACTIONS)[number]['id']): boolean =>
    busy || readOnly || (id !== 'insert' && !hasSelection)

  return (
    <>
      {/* Pestaña flotante pegada a la derecha (se mueve al borde del panel cuando está abierto). */}
      <button
        className="pages-toggle"
        style={{ right: open ? PANEL_WIDTH : 0 }}
        title={open ? 'Ocultar páginas' : 'Mostrar páginas'}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▶' : '◀'}
      </button>

      {open && (
        <aside className="pages-panel">
          <div className="pages-head">
            <span>Páginas</span>
            <span className="pages-history">
              <button className="btn icon" onClick={undo} disabled={!canUndo} title="Deshacer (Cmd/Ctrl+Z)">
                <Icon name="undo" size={15} />
              </button>
              <button className="btn icon" onClick={redo} disabled={!canRedo} title="Rehacer (Cmd/Ctrl+Shift+Z)">
                <Icon name="redo" size={15} />
              </button>
            </span>
          </div>

          <div className="pages-actions">
            {ACTIONS.map((a) => (
              <button
                key={a.id}
                className={`page-action${a.id === 'delete' ? ' danger' : ''}`}
                disabled={isDisabled(a.id)}
                onClick={() => run(a.id)}
              >
                <span className="page-action-icon">
                  <Icon name={a.icon} size={20} />
                </span>
                <span className="page-action-label">{a.label}</span>
              </button>
            ))}
          </div>

          <div className="thumb-list" ref={listRef}>
            {/* Tantas como tiene el pdf.js con el que se pintan: tras insertar o
                borrar, el documento ya tiene otro nº de páginas pero el visor aún
                carga la versión nueva (antes se pedían páginas inexistentes). */}
            {pdf &&
              Array.from({ length: pdf.numPages }, (_, i) => (
                <Thumbnail
                  key={i}
                  pdf={pdf}
                  index={i}
                  selected={selected.has(i)}
                  current={currentPage === i + 1}
                  draggable={!readOnly}
                  dropAt={dropIndex === i && dragIndex !== null ? dropSide(dragIndex, i) : null}
                  onSelect={onThumbClick}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={() => setDropIndex(i)}
                  onDrop={() => onDrop(i)}
                  onDragEnd={() => {
                    // Arrastre soltado fuera de la lista o cancelado (Esc): sin indicador colgado.
                    setDragIndex(null)
                    setDropIndex(null)
                  }}
                />
              ))}
          </div>
        </aside>
      )}
    </>
  )
}

interface ThumbnailProps {
  pdf: PDFDocumentProxy
  index: number
  selected: boolean
  /** Es la página que se está viendo en el visor. */
  current: boolean
  /** Se puede arrastrar para reordenar (no en un PDF de solo lectura). */
  draggable: boolean
  /** Si se está arrastrando otra miniatura encima: dónde quedará al soltarla. */
  dropAt: 'before' | 'after' | null
  onSelect: (index: number, e: MouseEvent) => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}

function Thumbnail(props: ThumbnailProps): JSX.Element {
  const { pdf, index, selected, current, dropAt } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const job = renderThumbnail(pdf, index + 1, canvas, THUMB_WIDTH)
    job.promise.catch((err) => {
      if (!isRenderCancelled(err)) console.warn(`Miniatura de la página ${index + 1}:`, err)
    })
    return () => job.cancel()
  }, [pdf, index])

  return (
    <div
      className={`thumb${selected ? ' selected' : ''}${current ? ' current' : ''}${dropAt ? ` drop-${dropAt}` : ''}`}
      data-index={index}
      title={`Página ${index + 1}`}
      draggable={props.draggable}
      onClick={(e) => props.onSelect(index, e)}
      onDragStart={props.onDragStart}
      onDragOver={(e) => {
        e.preventDefault()
        props.onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        props.onDrop()
      }}
      onDragEnd={props.onDragEnd}
    >
      <canvas ref={canvasRef} className="thumb-canvas" />
      <span className="thumb-number">{index + 1}</span>
    </div>
  )
}
