import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'
import { usePages } from '../state/pages.context'
import { renderThumbnail } from '../services/pdf-renderer'
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
 */
export function PagesPanel(): JSX.Element | null {
  const { state, undo, redo, canUndo, canRedo } = useDocument()
  const { pdf } = usePdf()
  const { selected, total, select, reorder, hasSelection, busy, rotate, remove, duplicate, extract, insert } =
    usePages()
  const [open, setOpen] = useState(true)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const doc = state.doc

  if (!doc) return null

  const onDrop = (target: number): void => {
    setDropIndex(null)
    if (dragIndex !== null) reorder(dragIndex, target)
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

  const isDisabled = (id: (typeof ACTIONS)[number]['id']): boolean =>
    busy || (id !== 'insert' && !hasSelection)

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

          <div className="thumb-list">
            {pdf &&
              Array.from({ length: total }, (_, i) => (
                <Thumbnail
                  key={`${doc.dataBase64.length}-${i}`}
                  pdf={pdf}
                  index={i}
                  selected={selected.has(i)}
                  isDropTarget={dropIndex === i}
                  onSelect={(index, e) => select(index, { shift: e.shiftKey, meta: e.ctrlKey || e.metaKey })}
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={() => setDropIndex(i)}
                  onDrop={() => onDrop(i)}
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
  isDropTarget: boolean
  onSelect: (index: number, e: MouseEvent) => void
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
}

function Thumbnail(props: ThumbnailProps): JSX.Element {
  const { pdf, index, selected, isDropTarget } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    renderThumbnail(pdf, index + 1, canvas, THUMB_WIDTH).catch(() => {
      /* miniatura individual: ignorar fallo */
    })
  }, [pdf, index])

  return (
    <div
      className={`thumb${selected ? ' selected' : ''}${isDropTarget ? ' drop-target' : ''}`}
      draggable
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
    >
      <canvas ref={canvasRef} className="thumb-canvas" />
      <span className="thumb-number">{index + 1}</span>
    </div>
  )
}
