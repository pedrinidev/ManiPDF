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

/** Banner de error global, no intrusivo. */
function ErrorBanner(): JSX.Element | null {
  const { state } = useDocument()
  if (state.status !== 'error' || !state.error) return null
  return <div className="error-banner">⚠️ {state.error}</div>
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
