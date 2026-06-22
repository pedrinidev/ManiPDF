import type { JSX } from 'react'
import { useDocument } from '../state/document.store'
import { useAnnotations, type AnnotationTool } from '../state/annotations.context'
import { Icon, type IconName } from './Icon'

const TOOLS: { tool: AnnotationTool; icon: IconName; label: string }[] = [
  { tool: 'select', icon: 'select', label: 'Mover / seleccionar' },
  { tool: 'highlight', icon: 'highlight', label: 'Resaltar' },
  { tool: 'underline', icon: 'underline', label: 'Subrayar' },
  { tool: 'rect', icon: 'square', label: 'Rectángulo' },
  { tool: 'ink', icon: 'pencil', label: 'Dibujar' },
  { tool: 'note', icon: 'note', label: 'Nota' },
  { tool: 'text', icon: 'text', label: 'Texto' }
]

const TEXT_SIZES: { label: string; size: number }[] = [
  { label: 'S', size: 0.015 },
  { label: 'M', size: 0.022 },
  { label: 'L', size: 0.035 }
]

/** Barra de anotaciones: herramientas, color, texto, firma y grabado en el PDF. */
export function AnnotationToolbar(): JSX.Element | null {
  const { state } = useDocument()
  const {
    tool,
    color,
    textSize,
    pendingImage,
    setTool,
    setColor,
    setTextSize,
    chooseImage,
    annotations,
    apply,
    clear,
    busy,
    toolbarOpen,
    setToolbarOpen
  } = useAnnotations()

  if (!state.doc || !toolbarOpen) return null

  const count = annotations.length

  // Cerrar la edición. Si hay anotaciones sin grabar, pregunta qué hacer.
  const closeAnnotations = async (): Promise<void> => {
    if (count > 0) {
      const choice = await window.api.app.confirmUnsaved({
        message: 'Tienes anotaciones sin grabar',
        detail: '¿Grabarlas en el PDF antes de cerrar la edición?',
        saveLabel: 'Grabar en PDF'
      })
      if (choice === 'cancel') return
      if (choice === 'save') await apply()
      else clear()
    }
    setToolbarOpen(false)
  }

  return (
    <div className="anno-toolbar">
      <button className="btn icon" title="Cerrar anotación" onClick={closeAnnotations}>
        <Icon name="x" size={16} />
      </button>
      <div className="anno-tools">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`btn icon${tool === t.tool ? ' active' : ''}`}
            title={t.label}
            onClick={() => setTool(t.tool)}
          >
            <Icon name={t.icon} size={17} />
          </button>
        ))}
        <button
          className={`btn icon${tool === 'image' ? ' active' : ''}`}
          title="Firma / imagen"
          onClick={chooseImage}
        >
          <Icon name="image" size={17} />
        </button>
      </div>

      <label className="anno-color" title="Color">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          disabled={tool === 'select' || tool === 'image'}
        />
      </label>

      {tool === 'text' && (
        <div className="anno-tools" title="Tamaño de texto">
          {TEXT_SIZES.map((s) => (
            <button
              key={s.label}
              className={`btn icon${Math.abs(textSize - s.size) < 0.001 ? ' active' : ''}`}
              onClick={() => setTextSize(s.size)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {tool === 'select' && (
        <span className="anno-count">✋ Arrastra una anotación para moverla · Supr para borrarla</span>
      )}

      {tool === 'image' && (
        <span className="anno-count">
          {pendingImage ? 'Arrastra para colocar la firma' : 'Elige una imagen…'}
        </span>
      )}

      <div className="anno-apply">
        <span className="anno-count">{count > 0 ? `${count} elemento(s)` : 'Sin cambios'}</span>
        <button className="btn" onClick={clear} disabled={count === 0 || busy}>
          Limpiar
        </button>
        <button className="btn primary" onClick={apply} disabled={count === 0 || busy}>
          {busy ? 'Grabando…' : 'Grabar en PDF'}
        </button>
      </div>
    </div>
  )
}
