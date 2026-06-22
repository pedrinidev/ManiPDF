import { useEffect, type JSX } from 'react'
import { useDocument } from '../state/document.store'
import { useRedact } from '../state/redact.context'
import { useFormBuilder } from '../state/formbuilder.context'
import { useSeparations } from '../state/separations.context'
import { useAnnotations } from '../state/annotations.context'
import { Menu } from './Menu'
import { SecurityDialog } from './SecurityDialog'
import { OptimizeDialog } from './OptimizeDialog'
import { ConvertDialog } from './ConvertDialog'
import { ExportDialog } from './ExportDialog'
import { FormsDialog } from './FormsDialog'
import { OcrDialog } from './OcrDialog'
import { StampDialog } from './StampDialog'
import { CombineDialog } from './CombineDialog'
import { CompareDialog } from './CompareDialog'
import { SearchBar } from './SearchBar'
import { Icon } from './Icon'

/** Barra de menú superior (Archivo / Editar / Ver / Herramientas) estilo escritorio. */
export function MenuBar(): JSX.Element {
  const { state, openDialog, save, saveAs, print, closeDoc, setZoom, hasUnsavedAnnotations, undo, redo, canUndo, canRedo } =
    useDocument()
  const { start: startRedact } = useRedact()
  const { start: startFields } = useFormBuilder()
  const { start: startSeparations } = useSeparations()
  const { setToolbarOpen } = useAnnotations()
  const { doc, zoom } = state
  const hasDoc = !!doc
  const modKey = window.api.system.platform === 'darwin' ? '⌘' : 'Ctrl+'

  // Atajos de teclado principales (estilo escritorio).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      // Si se está escribiendo en un campo, no secuestramos deshacer/rehacer
      // (que el texto use su propio deshacer nativo).
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      switch (key) {
        case 'o': // Abrir
          e.preventDefault()
          openDialog()
          break
        case 's': // Guardar / Guardar como (con Shift)
          if (!hasDoc) return
          e.preventDefault()
          e.shiftKey ? saveAs() : save()
          break
        case 'p': // Imprimir
          if (!hasDoc) return
          e.preventDefault()
          print()
          break
        case 'w': // Cerrar pestaña
          if (!hasDoc) return
          e.preventDefault()
          closeDoc()
          break
        case 'z': // Deshacer / Rehacer (Shift)
          if (!hasDoc || typing) return
          e.preventDefault()
          e.shiftKey ? redo() : undo()
          break
        case 'y': // Rehacer (Windows)
          if (!hasDoc || typing) return
          e.preventDefault()
          redo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasDoc, openDialog, save, saveAs, print, closeDoc, undo, redo])

  return (
    <header className="menu-bar">
      <div className="menu-bar-menus">
        <Menu label="Archivo">
          <button className="btn menu-item" onClick={openDialog}>
            <span>Abrir…</span>
            <kbd>{modKey}O</kbd>
          </button>
          <button className="btn menu-item" onClick={save} disabled={!hasDoc}>
            <span>Guardar</span>
            <kbd>{modKey}S</kbd>
          </button>
          <button className="btn menu-item" onClick={saveAs} disabled={!hasDoc}>
            <span>Guardar como…</span>
            <kbd>{modKey}⇧S</kbd>
          </button>
          <div className="menu-sep" />
          <button className="btn menu-item" onClick={print} disabled={!hasDoc}>
            <span>Imprimir…</span>
            <kbd>{modKey}P</kbd>
          </button>
          <div className="menu-sep" />
          <ExportDialog />
          <ConvertDialog />
          <CombineDialog />
          <div className="menu-sep" />
          <button className="btn menu-item" onClick={() => closeDoc()} disabled={!hasDoc}>
            <span>Cerrar pestaña</span>
            <kbd>{modKey}W</kbd>
          </button>
        </Menu>

        <Menu label="Editar">
          <button className="btn menu-item" onClick={undo} disabled={!canUndo}>
            <span>Deshacer</span>
            <kbd>{modKey}Z</kbd>
          </button>
          <button className="btn menu-item" onClick={redo} disabled={!canRedo}>
            <span>Rehacer</span>
            <kbd>{modKey}⇧Z</kbd>
          </button>
          <div className="menu-sep" />
          <button className="btn" onClick={() => setToolbarOpen(true)} disabled={!hasDoc}>
            Anotar…
          </button>
          <FormsDialog />
          <button className="btn" onClick={startFields} disabled={!hasDoc}>
            Crear campos…
          </button>
          <button className="btn" onClick={startRedact} disabled={!hasDoc}>
            Censurar (ocultar datos)…
          </button>
        </Menu>

        <Menu label="Ver">
          <button className="btn" onClick={() => setZoom(zoom + 0.25)} disabled={!hasDoc}>
            Acercar
          </button>
          <button className="btn" onClick={() => setZoom(zoom - 0.25)} disabled={!hasDoc}>
            Alejar
          </button>
          <button className="btn" onClick={() => setZoom(1)} disabled={!hasDoc}>
            Zoom 100%
          </button>
        </Menu>

        <Menu label="Herramientas">
          <SecurityDialog />
          <OptimizeDialog />
          <StampDialog />
          <CompareDialog />
          <OcrDialog />
          <button className="btn" onClick={startSeparations} disabled={!hasDoc}>
            Separación color…
          </button>
        </Menu>
      </div>

      <div className="menu-bar-title">
        {doc ? (
          <>
            {doc.fileName}
            {(doc.isDirty || hasUnsavedAnnotations) && (
              <span className="dirty-dot" title="Cambios sin guardar">
                ●
              </span>
            )}
            <span className="page-count">· {doc.pageCount} pág.</span>
          </>
        ) : (
          'ManiPDF'
        )}
      </div>

      <div className="menu-bar-actions">
        {hasDoc && <SearchBar />}
        <button
          className="btn icon"
          onClick={print}
          disabled={!hasDoc}
          title="Imprimir (Cmd/Ctrl+P)"
          aria-label="Imprimir"
        >
          <Icon name="printer" size={16} />
        </button>
      </div>

      <div className="menu-bar-zoom">
        <button className="btn icon" onClick={() => setZoom(zoom - 0.25)} disabled={!hasDoc} aria-label="Alejar">
          <Icon name="minus" size={16} />
        </button>
        <span className="zoom-value">{Math.round(zoom * 100)}%</span>
        <button className="btn icon" onClick={() => setZoom(zoom + 0.25)} disabled={!hasDoc} aria-label="Acercar">
          <Icon name="plus" size={16} />
        </button>
      </div>
    </header>
  )
}
