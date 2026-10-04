import { useEffect, type JSX } from 'react'
import { useDocument } from '../state/document.store'
import { useRedact } from '../state/redact.context'
import { useFormBuilder } from '../state/formbuilder.context'
import { useSeparations } from '../state/separations.context'
import { useAnnotations } from '../state/annotations.context'
import { usePdf } from '../state/pdf.context'
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
import { AboutDialog } from './AboutDialog'
import { InfoDialog } from './InfoDialog'
import { PageNavigator } from './PageNavigator'
import { Icon } from './Icon'
import { zoomActionForKey } from '../services/zoom'

/** Barra de menú superior (Archivo / Editar / Ver / Herramientas) estilo escritorio. */
export function MenuBar(): JSX.Element {
  const { state, openDialog, save, saveAs, print, closeDoc, zoomStep, hasUnsavedEdits, undo, redo, canUndo, canRedo } =
    useDocument()
  const { start: startRedact } = useRedact()
  const { start: startFields } = useFormBuilder()
  const { start: startSeparations } = useSeparations()
  const { setToolbarOpen } = useAnnotations()
  const { printingAllowed } = usePdf()
  const { doc, zoom } = state
  const hasDoc = !!doc
  // PDF protegido aún cifrado: se ve pero no se puede modificar (ver ReadOnlyBanner).
  const canEdit = hasDoc && !doc.readOnly
  const canPrint = hasDoc && printingAllowed
  const modKey = window.api.system.platform === 'darwin' ? '⌘' : 'Ctrl+'

  // Atajos de teclado principales (estilo escritorio).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Cmd/Ctrl + «+», «−», «0»: zoom del VISOR (re-pinta nítido). Sin esto, en
      // macOS los capturaba el zoom de Chromium y estiraba la página ya pintada.
      const zoomAction = zoomActionForKey(e)
      if (zoomAction) {
        if (!hasDoc) return
        e.preventDefault()
        zoomStep(zoomAction)
        return
      }
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
          if (!canPrint) return
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
  }, [hasDoc, canPrint, openDialog, save, saveAs, print, closeDoc, undo, redo, zoomStep])

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
          <button
            className="btn menu-item"
            onClick={print}
            disabled={!canPrint}
            title={hasDoc && !printingAllowed ? 'El documento no permite imprimir' : undefined}
          >
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
          <button className="btn" onClick={() => setToolbarOpen(true)} disabled={!canEdit}>
            Anotar…
          </button>
          <FormsDialog />
          <button className="btn" onClick={startFields} disabled={!canEdit}>
            Crear campos…
          </button>
          <button className="btn" onClick={startRedact} disabled={!canEdit}>
            Censurar (ocultar datos)…
          </button>
        </Menu>

        <Menu label="Ver">
          <button className="btn menu-item" onClick={() => zoomStep('in')} disabled={!hasDoc}>
            <span>Acercar</span>
            <kbd>{modKey}+</kbd>
          </button>
          <button className="btn menu-item" onClick={() => zoomStep('out')} disabled={!hasDoc}>
            <span>Alejar</span>
            <kbd>{modKey}−</kbd>
          </button>
          <button className="btn menu-item" onClick={() => zoomStep('reset')} disabled={!hasDoc}>
            <span>Zoom 100%</span>
            <kbd>{modKey}0</kbd>
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

        <AboutDialog />
        <InfoDialog />
      </div>

      <div className="menu-bar-title">
        {doc ? (
          <>
            {doc.fileName}
            {(doc.isDirty || hasUnsavedEdits) && (
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
          className="btn icon menu-bar-print"
          onClick={print}
          disabled={!canPrint}
          title={hasDoc && !printingAllowed ? 'El documento no permite imprimir' : 'Imprimir (Cmd/Ctrl+P)'}
          aria-label="Imprimir"
        >
          <Icon name="printer" size={16} />
        </button>
      </div>

      {hasDoc && <PageNavigator />}

      <div className="menu-bar-zoom">
        <button
          className="btn icon"
          onClick={() => zoomStep('out')}
          disabled={!hasDoc}
          title={`Alejar (${modKey}−)`}
          aria-label="Alejar"
        >
          <Icon name="minus" size={16} />
        </button>
        <span
          className="zoom-value"
          onDoubleClick={() => zoomStep('reset')}
          title={`Doble clic (o ${modKey}0) para volver al 100%`}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="btn icon"
          onClick={() => zoomStep('in')}
          disabled={!hasDoc}
          title={`Acercar (${modKey}+)`}
          aria-label="Acercar"
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
    </header>
  )
}
