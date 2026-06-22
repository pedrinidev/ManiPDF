import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { useRedact } from '../state/redact.context'
import type { RectArea } from '@shared/ipc-contract'

/**
 * Overlay del modo redacción: arrastra para marcar zonas (rectángulos negros) y
 * clic en una zona para quitarla. Solo se monta cuando el modo está activo.
 */
export function RedactLayer({ pageNumber }: { pageNumber: number }): JSX.Element | null {
  const { active, rects, addRect, removeRect } = useRedact()
  const layerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<{ start: { x: number; y: number }; cur: { x: number; y: number } } | null>(null)

  if (!active) return null

  const pageRects = rects.filter((r) => r.page === pageNumber)

  const norm = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = layerRef.current!.getBoundingClientRect()
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }
  }

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (e.button !== 0) return
    // Clic sobre una zona existente: lo gestiona su onClick (borrar).
    if ((e.target as Element).tagName === 'rect') return
    layerRef.current?.setPointerCapture(e.pointerId)
    const p = norm(e)
    setDraft({ start: p, cur: p })
  }

  const onPointerMove = (e: ReactPointerEvent): void => {
    if (!draft) return
    setDraft({ ...draft, cur: norm(e) })
  }

  const onPointerUp = (): void => {
    if (!draft) return
    const rect = rectFrom(draft.start, draft.cur)
    if (rect.w > 0.004 && rect.h > 0.004) addRect(pageNumber, rect)
    setDraft(null)
  }

  return (
    <div
      ref={layerRef}
      className="redact-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className="redact-svg" viewBox="0 0 1 1" preserveAspectRatio="none">
        {pageRects.map((r) => (
          <rect
            key={r.id}
            x={r.rect.x}
            y={r.rect.y}
            width={r.rect.w}
            height={r.rect.h}
            className="redact-rect"
            onClick={() => removeRect(r.id)}
          />
        ))}
        {draft && <rect {...rectAttrs(rectFrom(draft.start, draft.cur))} className="redact-rect draft" />}
      </svg>
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
