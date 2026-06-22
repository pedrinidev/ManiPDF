import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from './document.store'
import { loadPdf } from '../services/pdf-renderer'

/**
 * Carga UNA sola instancia pdf.js del documento activo y la comparte con
 * todas las vistas (visor + miniaturas). Se recarga cuando cambian los bytes
 * (al editar páginas) y destruye la anterior para no fugar memoria.
 */
interface PdfContextValue {
  pdf: PDFDocumentProxy | null
  loading: boolean
  error: string | null
}

const PdfContext = createContext<PdfContextValue | null>(null)

export function PdfProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state } = useDocument()
  const doc = state.doc
  const [value, setValue] = useState<PdfContextValue>({ pdf: null, loading: false, error: null })
  const currentPdf = useRef<PDFDocumentProxy | null>(null)
  const currentDocId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!doc) {
      currentPdf.current?.destroy()
      currentPdf.current = null
      currentDocId.current = null
      setValue({ pdf: null, loading: false, error: null })
      return
    }

    // Si es el MISMO documento que se recarga (p. ej. tras grabar/editar páginas),
    // mantenemos el render anterior visible mientras carga el nuevo → sin parpadeo
    // en blanco. Si es OTRO documento/pestaña, sí limpiamos antes de cargar.
    const sameDoc = doc.id === currentDocId.current
    if (sameDoc) {
      setValue((v) => ({ pdf: v.pdf, loading: true, error: null }))
    } else {
      currentPdf.current?.destroy()
      currentPdf.current = null
      setValue({ pdf: null, loading: true, error: null })
    }
    currentDocId.current = doc.id

    loadPdf(doc.dataBase64)
      .then((p) => {
        if (cancelled) {
          p.destroy()
          return
        }
        const prev = currentPdf.current
        currentPdf.current = p
        setValue({ pdf: p, loading: false, error: null })
        if (prev && prev !== p) prev.destroy() // libera el anterior tras el swap
      })
      .catch((err) => {
        if (!cancelled) {
          setValue({
            pdf: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Error al renderizar'
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [doc?.id, doc?.dataBase64])

  return <PdfContext.Provider value={value}>{children}</PdfContext.Provider>
}

export function usePdf(): PdfContextValue {
  const ctx = useContext(PdfContext)
  if (!ctx) throw new Error('usePdf debe usarse dentro de <PdfProvider>')
  return ctx
}
