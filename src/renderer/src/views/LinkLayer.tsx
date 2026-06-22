import { useEffect, useState, type JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdf } from '../state/pdf.context'
import { goToPage, openExternal } from '../services/navigate'

/** Un enlace resuelto sobre la página, en coordenadas normalizadas (0..1, origen arriba). */
interface ResolvedLink {
  x: number
  y: number
  w: number
  h: number
  url?: string
  pageNumber?: number
}

/** Overlay de enlaces clicables (internos → saltan de página; externos → navegador). */
export function LinkLayer({ pageNumber }: { pageNumber: number }): JSX.Element | null {
  const { pdf } = usePdf()
  const [links, setLinks] = useState<ResolvedLink[]>([])

  useEffect(() => {
    let cancelled = false
    if (!pdf) {
      setLinks([])
      return
    }
    resolveLinks(pdf, pageNumber)
      .then((l) => {
        if (!cancelled) setLinks(l)
      })
      .catch(() => {
        if (!cancelled) setLinks([])
      })
    return () => {
      cancelled = true
    }
  }, [pdf, pageNumber])

  if (links.length === 0) return null

  return (
    <div className="link-layer">
      {links.map((l, i) => (
        <button
          key={i}
          className="pdf-link"
          style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
          title={l.url ?? (l.pageNumber ? `Ir a la página ${l.pageNumber}` : undefined)}
          onClick={() => {
            if (l.url) openExternal(l.url)
            else if (l.pageNumber) goToPage(l.pageNumber)
          }}
        />
      ))}
    </div>
  )
}

interface RawAnnotation {
  subtype?: string
  rect?: number[]
  url?: string
  dest?: string | unknown[] | null
}

async function resolveLinks(pdf: PDFDocumentProxy, pageNumber: number): Promise<ResolvedLink[]> {
  const page = await pdf.getPage(pageNumber)
  const vp = page.getViewport({ scale: 1 })
  const annotations = (await page.getAnnotations()) as RawAnnotation[]
  const out: ResolvedLink[] = []

  for (const ann of annotations) {
    if (ann.subtype !== 'Link' || !ann.rect) continue
    const [x1, y1, x2, y2] = ann.rect
    const rect = {
      x: Math.min(x1, x2) / vp.width,
      y: 1 - Math.max(y1, y2) / vp.height,
      w: Math.abs(x2 - x1) / vp.width,
      h: Math.abs(y2 - y1) / vp.height
    }
    if (ann.url) {
      out.push({ ...rect, url: ann.url })
    } else if (ann.dest) {
      const pageNum = await resolveDestination(pdf, ann.dest)
      if (pageNum) out.push({ ...rect, pageNumber: pageNum })
    }
  }
  return out
}

async function resolveDestination(
  pdf: PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const index = await pdf.getPageIndex(
      explicit[0] as Parameters<PDFDocumentProxy['getPageIndex']>[0]
    )
    return index + 1
  } catch {
    return null
  }
}
