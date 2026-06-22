import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { Viewer } from '../views/Viewer'
import { useDocument } from '../state/document.store'
import { usePdf } from '../state/pdf.context'

/** ¿El foco está en un control interactivo? (para no robar la barra espaciadora). */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'BUTTON' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

/**
 * Contenedor desplazable del documento con "mano" estilo InDesign: mantén la
 * barra espaciadora para activar la mano y arrastra para desplazar el documento.
 */
export function DocumentScroll(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [handMode, setHandMode] = useState(false)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  // Conservar la posición de scroll cuando el MISMO documento se recarga (p. ej.
  // tras "Grabar en PDF", que reemplaza los bytes). Al cambiar de documento o
  // pestaña se va arriba (comportamiento esperado).
  const { state } = useDocument()
  const { pdf, loading } = usePdf()
  const docId = state.doc?.id ?? null
  const lastTop = useRef(0)
  const lastDocId = useRef<string | null>(null)

  const onScroll = (): void => {
    if (ref.current && !loading) lastTop.current = ref.current.scrollTop
  }

  useEffect(() => {
    const el = ref.current
    if (!pdf || !el) return
    if (docId !== lastDocId.current) {
      // Documento/pestaña distintos → arriba.
      lastDocId.current = docId
      lastTop.current = 0
      el.scrollTop = 0
      return
    }
    // Mismo documento recargado → restaurar la posición (las páginas se pintan
    // de forma asíncrona, así que reintentamos hasta que la altura lo permita).
    const target = lastTop.current
    if (target <= 0) return
    let tries = 0
    const restore = (): void => {
      const node = ref.current
      if (!node) return
      node.scrollTop = target
      if (++tries < 30 && Math.abs(node.scrollTop - target) > 1) requestAnimationFrame(restore)
    }
    requestAnimationFrame(restore)
  }, [pdf, docId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault() // evita que la barra espaciadora haga scroll de página
        setHandMode(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        setHandMode(false)
        drag.current = null
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const onPointerDown = (e: ReactPointerEvent): void => {
    if (!handMode || !ref.current) return
    e.preventDefault()
    ref.current.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, left: ref.current.scrollLeft, top: ref.current.scrollTop }
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    const d = drag.current
    if (!d || !ref.current) return
    ref.current.scrollLeft = d.left - (e.clientX - d.x)
    ref.current.scrollTop = d.top - (e.clientY - d.y)
  }
  const onPointerUp = (): void => {
    drag.current = null
  }

  return (
    <main
      ref={ref}
      className={`content${handMode ? ' hand' : ''}`}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Viewer />
    </main>
  )
}
