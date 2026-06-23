import type { JSX, MouseEvent } from 'react'
import { useDocument } from '../state/document.store'
import { Icon } from './Icon'

/** Barra de pestañas: un documento por pestaña, estilo navegador. */
export function TabBar(): JSX.Element | null {
  const { state, setActive, closeDoc, openDialog, hasUnsavedEdits } = useDocument()
  if (state.docs.length === 0) return null

  const onClose = (e: MouseEvent, id: string): void => {
    e.stopPropagation()
    closeDoc(id)
  }

  return (
    <div className="tab-bar">
      {state.docs.map((d) => (
        <div
          key={d.id}
          className={`tab${d.id === state.activeId ? ' active' : ''}`}
          title={d.filePath ?? d.fileName}
          onClick={() => setActive(d.id)}
        >
          <span className="tab-name">{d.fileName}</span>
          {(d.isDirty || (d.id === state.activeId && hasUnsavedEdits)) && (
            <span className="tab-dirty" title="Cambios sin guardar">●</span>
          )}
          <button className="tab-close" title="Cerrar pestaña" onClick={(e) => onClose(e, d.id)}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      <button className="tab-new" title="Abrir otro PDF" onClick={openDialog}>
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}
