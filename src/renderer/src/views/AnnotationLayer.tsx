import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useAnnotations } from '../state/annotations.context'
import type { Annotation, Point, RectArea } from '@shared/ipc-contract'

/** Borrador de la anotación que se está dibujando con el ratón. */
type Draft =
  | { kind: 'rect'; start: Point; cur: Point }
  | { kind: 'ink'; points: Point[] }

const INK_WIDTH_FRACTION = 0.003

/**
 * Overlay interactivo sobre una página. Dibuja las anotaciones existentes y
 * captura el ratón para crear nuevas según la herramienta activa.
 * Todas las coordenadas se manejan normalizadas (0..1) → independientes del zoom.
 */
export function AnnotationLayer({ pageNumber }: { pageNumber: number }): JSX.Element {
  const { annotations, tool, color, textSize, pendingImage, selectedId, toolbarOpen, add, updateNote, updateText, select, move, remove } =
    useAnnotations()
  const layerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // Arrastre para reposicionar una anotación existente (herramienta "select").
  const [drag, setDrag] = useState<{ id: string; lastX: number; lastY: number } | null>(null)

  const pageAnnotations = annotations.filter((a) => a.page === pageNumber)

  const norm = (e: ReactPointerEvent): Point => {
    const r = layerRef.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    // Con la barra cerrada la capa es de solo lectura: ni se dibuja ni se mueve.
    if (!toolbarOpen) return
    // Solo botón principal.
    if (e.button !== 0) return
    const p = norm(e)

    if (tool === 'select') {
      // ¿Se pulsó sobre una anotación? (marcada con data-anno-id). Si sí, se
      // selecciona y empieza el arrastre para moverla; si no, se deselecciona.
      const hit = (e.target as Element).closest?.('[data-anno-id]') as Element | null
      const id = hit?.getAttribute('data-anno-id') ?? null
      if (id && hit) {
        select(id)
        // En modo selección la capa tiene pointer-events:none; capturamos en el
        // propio elemento (que sí los recibe) para que el arrastre siga al ratón.
        hit.setPointerCapture?.(e.pointerId)
        setDrag({ id, lastX: p.x, lastY: p.y })
      } else {
        select(null)
      }
      return
    }
    if (tool === 'note') {
      const id = uuid()
      add({ id, page: pageNumber, type: 'note', color, pos: p, text: '' })
      select(id)
      return
    }
    if (tool === 'text') {
      const id = uuid()
      add({ id, page: pageNumber, type: 'text', color, pos: p, text: '', size: textSize })
      select(id)
      return
    }
    layerRef.current?.setPointerCapture(e.pointerId)
    setDraft(tool === 'ink' ? { kind: 'ink', points: [p] } : { kind: 'rect', start: p, cur: p })
  }

  const onPointerMove = (e: ReactPointerEvent): void => {
    if (drag) {
      const p = norm(e)
      move(drag.id, p.x - drag.lastX, p.y - drag.lastY)
      setDrag({ ...drag, lastX: p.x, lastY: p.y })
      return
    }
    if (!draft) return
    const p = norm(e)
    setDraft(draft.kind === 'ink' ? { kind: 'ink', points: [...draft.points, p] } : { ...draft, cur: p })
  }

  const onPointerUp = (): void => {
    if (drag) {
      setDrag(null)
      return
    }
    if (!draft) return
    if (draft.kind === 'ink') {
      if (draft.points.length > 1) {
        add({ id: uuid(), page: pageNumber, type: 'ink', color, points: draft.points, width: INK_WIDTH_FRACTION })
      }
    } else {
      const rect = rectFrom(draft.start, draft.cur)
      const big = rect.w > 0.005 && (tool === 'underline' ? true : rect.h > 0.005)
      if (big && (tool === 'highlight' || tool === 'underline' || tool === 'rect')) {
        add({ id: uuid(), page: pageNumber, type: tool, color, rect })
      } else if (big && tool === 'image' && pendingImage) {
        add({
          id: uuid(),
          page: pageNumber,
          type: 'image',
          color,
          rect,
          dataBase64: pendingImage.dataBase64,
          format: pendingImage.format
        })
      }
    }
    setDraft(null)
  }

  return (
    <div
      ref={layerRef}
      className={`anno-layer tool-${tool}${toolbarOpen ? ' editing' : ''}${drag ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="anno-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {pageAnnotations.map((a) => (
          <Shape key={a.id} ann={a} selected={a.id === selectedId} onSelect={() => select(a.id)} />
        ))}
        {draft && <DraftShape draft={draft} tool={tool} color={color} />}
      </svg>

      {pageAnnotations
        .filter((a): a is Extract<Annotation, { type: 'note' }> => a.type === 'note')
        .map((a) => (
          <Note
            key={a.id}
            ann={a}
            selected={a.id === selectedId}
            dragMode={tool === 'select'}
            onSelect={() => select(a.id)}
            onChange={(text) => updateNote(a.id, text)}
            onDelete={() => remove(a.id)}
          />
        ))}

      {pageAnnotations
        .filter((a): a is Extract<Annotation, { type: 'text' }> => a.type === 'text')
        .map((a) => (
          <TextBox
            key={a.id}
            ann={a}
            selected={a.id === selectedId}
            dragMode={tool === 'select'}
            onSelect={() => select(a.id)}
            onChange={(text) => updateText(a.id, text)}
            onDelete={() => remove(a.id)}
          />
        ))}
    </div>
  )
}

/** Render SVG de una anotación (las notas se renderizan aparte en HTML). */
function Shape({
  ann,
  selected,
  onSelect
}: {
  ann: Annotation
  selected: boolean
  onSelect: () => void
}): JSX.Element | null {
  const sel = selected ? { strokeDasharray: '4', stroke: '#4c8dff', strokeWidth: 2 } : {}
  const click = {
    onClick: onSelect,
    'data-anno-id': ann.id,
    style: { cursor: 'pointer' as const },
    vectorEffect: 'non-scaling-stroke' as const
  }

  switch (ann.type) {
    case 'highlight':
      return <rect {...rectAttrs(ann.rect)} fill={ann.color} fillOpacity={0.35} {...click} {...sel} />
    case 'rect':
      return (
        <rect {...rectAttrs(ann.rect)} fill="none" stroke={ann.color} strokeWidth={2} {...click} {...(selected ? sel : {})} />
      )
    case 'underline': {
      const y = ann.rect.y + ann.rect.h
      return (
        <line
          x1={ann.rect.x}
          y1={y}
          x2={ann.rect.x + ann.rect.w}
          y2={y}
          stroke={ann.color}
          strokeWidth={2}
          {...click}
          {...(selected ? sel : {})}
        />
      )
    }
    case 'ink':
      return (
        <polyline
          points={ann.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={ann.color}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          {...click}
          {...(selected ? sel : {})}
        />
      )
    case 'image':
      return (
        <image
          href={`data:image/${ann.format === 'png' ? 'png' : 'jpeg'};base64,${ann.dataBase64}`}
          x={ann.rect.x}
          y={ann.rect.y}
          width={ann.rect.w}
          height={ann.rect.h}
          preserveAspectRatio="none"
          onClick={onSelect}
          data-anno-id={ann.id}
          style={{ cursor: 'pointer' }}
          {...(selected ? { stroke: '#4c8dff', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' as const } : {})}
        />
      )
    case 'note':
    case 'text':
      return null
  }
}

function DraftShape({ draft, tool, color }: { draft: Draft; tool: string; color: string }): JSX.Element {
  if (draft.kind === 'ink') {
    return (
      <polyline
        points={draft.points.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  const rect = rectFrom(draft.start, draft.cur)
  if (tool === 'underline') {
    const y = rect.y + rect.h
    return <line x1={rect.x} y1={y} x2={rect.x + rect.w} y2={y} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
  }
  if (tool === 'rect') {
    return <rect {...rectAttrs(rect)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
  }
  return <rect {...rectAttrs(rect)} fill={color} fillOpacity={0.35} />
}

/** Nota adhesiva en HTML (permite editar el texto). */
function Note({
  ann,
  selected,
  dragMode,
  onSelect,
  onChange,
  onDelete
}: {
  ann: Extract<Annotation, { type: 'note' }>
  selected: boolean
  dragMode: boolean
  onSelect: () => void
  onChange: (text: string) => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div
      className={`anno-note${selected ? ' selected' : ''}`}
      data-anno-id={ann.id}
      style={{ left: `${ann.pos.x * 100}%`, top: `${ann.pos.y * 100}%`, background: ann.color }}
      onPointerDown={(e) => {
        // En modo selección dejamos que la capa gestione seleccionar + arrastrar.
        if (dragMode) return
        e.stopPropagation()
        onSelect()
      }}
    >
      {selected ? (
        <>
          <textarea
            autoFocus
            value={ann.text}
            placeholder="Escribe una nota…"
            onChange={(e) => onChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <button className="anno-note-del" onClick={onDelete} title="Borrar nota">
            ×
          </button>
        </>
      ) : (
        <span className="anno-note-text">{ann.text || '📝'}</span>
      )}
    </div>
  )
}

/** Cuadro de texto visible y editable. La fuente escala con el zoom (unidad cqh). */
function TextBox({
  ann,
  selected,
  dragMode,
  onSelect,
  onChange,
  onDelete
}: {
  ann: Extract<Annotation, { type: 'text' }>
  selected: boolean
  dragMode: boolean
  onSelect: () => void
  onChange: (text: string) => void
  onDelete: () => void
}): JSX.Element {
  // cqh = 1% de la altura del contenedor (la capa); size es fracción 0..1.
  const fontSize = `${ann.size * 100}cqh`
  return (
    <div
      className={`anno-text${selected ? ' selected' : ''}`}
      data-anno-id={ann.id}
      style={{ left: `${ann.pos.x * 100}%`, top: `${ann.pos.y * 100}%`, color: ann.color, fontSize }}
      onPointerDown={(e) => {
        if (dragMode) return
        e.stopPropagation()
        onSelect()
      }}
    >
      {selected ? (
        <>
          <textarea
            autoFocus
            value={ann.text}
            placeholder="Escribe…"
            style={{ color: ann.color, fontSize }}
            onChange={(e) => onChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          />
          <button className="anno-note-del" onClick={onDelete} title="Borrar texto">
            ×
          </button>
        </>
      ) : (
        <span className="anno-text-content">{ann.text || 'Texto'}</span>
      )}
    </div>
  )
}

// -- helpers ----------------------------------------------------------------

function rectAttrs(r: RectArea): { x: number; y: number; width: number; height: number } {
  return { x: r.x, y: r.y, width: r.w, height: r.h }
}

function rectFrom(a: Point, b: Point): RectArea {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function uuid(): string {
  return crypto.randomUUID()
}
