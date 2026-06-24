import { useEffect, type JSX } from 'react'
import { DocumentProvider, useDocument } from './state/document.store'
import { PdfProvider } from './state/pdf.context'
import { AnnotationsProvider } from './state/annotations.context'
import { SearchProvider } from './state/search.context'
import { RedactProvider } from './state/redact.context'
import { FormBuilderProvider } from './state/formbuilder.context'
import { SeparationsProvider } from './state/separations.context'
import { PagesProvider } from './state/pages.context'
import { MenuBar } from './ui/MenuBar'
import { TabBar } from './ui/TabBar'
import { AnnotationToolbar } from './ui/AnnotationToolbar'
import { RedactBar } from './ui/RedactBar'
import { FormBuilderBar } from './ui/FormBuilderBar'
import { DocumentScroll } from './ui/DocumentScroll'
import { BookmarksPanel } from './views/BookmarksPanel'
import { SeparationPanel } from './views/SeparationPanel'
import { PagesPanel } from './views/PagesPanel'

/** Abre PDFs arrastrados a la ventana. */
function DragDropHandler(): null {
  const { openByPath } = useDocument()
  useEffect(() => {
    const onOver = (e: DragEvent): void => e.preventDefault()
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (file && /\.pdf$/i.test(file.name)) {
        const path = window.api.system.getPathForFile(file)
        if (path) openByPath(path)
      }
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openByPath])
  return null
}

/** Al estrenar la app (primera ejecución tras instalar), abre el manual de usuario. */
function FirstRunManual(): null {
  const { openManual } = useDocument()
  useEffect(() => {
    let done = false
    void (async () => {
      if (done) return
      const isFirstRun = await window.api.app.firstRun()
      if (!isFirstRun || done) return
      const path = await window.api.app.manualPath()
      if (path && !done) await openManual(path, true)
    })()
    return () => {
      done = true
    }
  }, [openManual])
  return null
}

/** Banner de error global, no intrusivo. Se cierra con la X o solo a los 5 s. */
function ErrorBanner(): JSX.Element | null {
  const { state, clearError } = useDocument()
  const showing = state.status === 'error' && !!state.error

  // Auto-cierre tras 5 segundos (se reinicia con cada error nuevo).
  useEffect(() => {
    if (!showing) return
    const t = setTimeout(clearError, 5000)
    return () => clearTimeout(t)
  }, [showing, state.error, clearError])

  if (!showing) return null
  return (
    <div className="error-banner">
      <span className="error-banner-text">⚠️ {state.error}</span>
      <button className="error-banner-close" onClick={clearError} title="Cerrar" aria-label="Cerrar aviso">
        ×
      </button>
    </div>
  )
}

export function App(): JSX.Element {
  return (
    <DocumentProvider>
      <PdfProvider>
        <AnnotationsProvider>
          <SearchProvider>
            <RedactProvider>
              <FormBuilderProvider>
              <SeparationsProvider>
              <PagesProvider>
              <div className="app">
                <DragDropHandler />
                <FirstRunManual />
                <MenuBar />
                <TabBar />
                <AnnotationToolbar />
                <RedactBar />
                <FormBuilderBar />
                <ErrorBanner />
                <div className="workspace">
                  <SeparationPanel />
                  <BookmarksPanel />
                  <DocumentScroll />
                  <PagesPanel />
                </div>
              </div>
              </PagesProvider>
              </SeparationsProvider>
              </FormBuilderProvider>
            </RedactProvider>
          </SearchProvider>
        </AnnotationsProvider>
      </PdfProvider>
    </DocumentProvider>
  )
}
