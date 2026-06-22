import { useEffect, useState, type JSX } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdf } from '../state/pdf.context'
import { goToPage } from '../services/navigate'

/** Marcador resuelto: título + nº de página destino + hijos. */
interface BookmarkNode {
  title: string
  pageNumber: number | null
  children: BookmarkNode[]
}

/** Panel lateral de marcadores. Solo se muestra si el PDF tiene índice. */
export function BookmarksPanel(): JSX.Element | null {
  const { pdf } = usePdf()
  const [nodes, setNodes] = useState<BookmarkNode[]>([])

  useEffect(() => {
    let cancelled = false
    if (!pdf) {
      setNodes([])
      return
    }
    buildOutline(pdf)
      .then((tree) => {
        if (!cancelled) setNodes(tree)
      })
      .catch(() => {
        if (!cancelled) setNodes([])
      })
    return () => {
      cancelled = true
    }
  }, [pdf])

  if (nodes.length === 0) return null

  return (
    <aside className="bookmarks-panel">
      <div className="panel-title">Marcadores</div>
      <div className="bookmarks-list">
        {nodes.map((n, i) => (
          <BookmarkItem key={i} node={n} depth={0} />
        ))}
      </div>
    </aside>
  )
}

function BookmarkItem({ node, depth }: { node: BookmarkNode; depth: number }): JSX.Element {
  return (
    <>
      <button
        className="bookmark"
        style={{ paddingLeft: 8 + depth * 14 }}
        disabled={node.pageNumber === null}
        title={node.pageNumber ? `Ir a la página ${node.pageNumber}` : undefined}
        onClick={() => node.pageNumber && goToPage(node.pageNumber)}
      >
        {node.title || '(sin título)'}
      </button>
      {node.children.map((c, i) => (
        <BookmarkItem key={i} node={c} depth={depth + 1} />
      ))}
    </>
  )
}

// -- resolución del outline de pdf.js -------------------------------------

interface RawOutline {
  title: string
  dest: string | unknown[] | null
  items: RawOutline[]
}

async function buildOutline(pdf: PDFDocumentProxy): Promise<BookmarkNode[]> {
  const raw = (await pdf.getOutline()) as RawOutline[] | null
  if (!raw) return []
  return Promise.all(raw.map((item) => resolveNode(pdf, item)))
}

async function resolveNode(pdf: PDFDocumentProxy, item: RawOutline): Promise<BookmarkNode> {
  return {
    title: item.title,
    pageNumber: await resolveDestination(pdf, item.dest),
    children: await Promise.all((item.items ?? []).map((c) => resolveNode(pdf, c)))
  }
}

async function resolveDestination(
  pdf: PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit.length === 0) return null
    const ref = explicit[0]
    // ref es una referencia de página; getPageIndex devuelve el índice 0-based.
    const index = await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
    return index + 1
  } catch {
    return null
  }
}
