import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useFormBuilder } from '../state/formbuilder.context'
import type { RectArea } from '@shared/ipc-contract'

/** Overlay del modo "crear campos": arrastra para colocar; clic en un campo para quitarlo. */
export function FormBuilderLayer({ pageNumber }: { pageNumber: number }): JSX.Element | null {
  const { active, fields, addField, removeField } = useFormBuilder()
  const layerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{ start: { x: number; y: number }; cur: { x: number; y: number } } | null>(null)

  if (!active) return null

  const pageFields = fields.filter((f) => f.page === pageNumber)

  const norm = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = layerRef.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0) return
    if ((e.target as Element).tagName === 'rect' || (e.target as Element).tagName === 'text') return
    layerRef.current?.setPointerCapture(e.pointerId)
    const p = norm(e)
    setDraft({ start: p, cur: p })
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    if (draft) setDraft({ ...draft, cur: norm(e) })
  }
  const onPointerUp = (): void => {
    if (!draft) return
    const rect = rectFrom(draft.start, draft.cur)
    if (rect.w > 0.01 && rect.h > 0.008) addField(pageNumber, rect)
    setDraft(null)
  }

  return (
    <div
      ref={layerRef}
      className="formbuilder-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="formbuilder-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {pageFields.map((f) => (
          <g key={f.id} onClick={() => removeField(f.id)} style={{ cursor: 'pointer' }}>
            <rect
              x={f.rect.x}
              y={f.rect.y}
              width={f.rect.w}
              height={f.rect.h}
              className="formbuilder-rect"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {draft && (
          <rect {...rectAttrs(rectFrom(draft.start, draft.cur))} className="formbuilder-rect draft" vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      {pageFields.map((f) => (
        <span
          key={`l-${f.id}`}
          className="formbuilder-label"
          style={{ left: `${f.rect.x * 100}%`, top: `${f.rect.y * 100}%` }}
        >
          {f.name}
        </span>
      ))}
    </div>
  )
}

function rectAttrs(r: RectArea): { x: number; y: number; width: number; height: number } {
  return { x: r.x, y: r.y, width: r.w, height: r.h }
}
function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): RectArea {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
