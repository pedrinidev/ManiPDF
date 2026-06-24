import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { Icon } from './Icon'
import { useDocument } from '../state/document.store'
import { documentClient } from '../services/document.client'
import type { DocumentMetadataDTO } from '@shared/ipc-contract'

/**
 * Botón (icono) + modal con la información del documento: tamaños de página,
 * color, autor, fechas, versión, cifrado, etc. Los metadatos se piden al main
 * al abrir el panel.
 */
export function InfoDialog(): JSX.Element {
  const { state, reportError } = useDocument()
  const doc = state.doc
  const hasDoc = !!doc

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [meta, setMeta] = useState<DocumentMetadataDTO | null>(null)

  const openPanel = async (): Promise<void> => {
    if (!doc) return
    setOpen(true)
    setBusy(true)
    setMeta(null)
    try {
      setMeta(await documentClient.metadata(doc.id))
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'No se pudo leer la información')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        className="btn icon"
        onClick={openPanel}
        disabled={!hasDoc}
        title="Información del documento"
        aria-label="Información del documento"
      >
        <Icon name="info" size={16} />
      </button>

      {open && (
        <Portal>
          <div className="modal-backdrop" onMouseDown={bumpModal}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>Información del documento</h3>

              {busy && <p className="info-loading">Leyendo metadatos…</p>}

              {meta && doc && (
                <dl className="info-grid">
                  <Row label="Archivo" value={doc.fileName} />
                  {doc.filePath && <Row label="Ubicación" value={doc.filePath} mono />}
                  <Row label="Páginas" value={String(meta.pageCount)} />
                  <Row label="Tamaño de página" value={pageSizeText(meta)} />
                  <Row label="Color" value={meta.colorSpace} />
                  <Row label="Tamaño del archivo" value={formatSize(meta.fileSize)} />
                  <Row label="Versión PDF" value={meta.pdfVersion ?? '—'} />
                  <Row label="Cifrado" value={meta.encrypted ? 'Sí' : 'No'} />
                  <Row label="Título" value={meta.title} />
                  <Row label="Autor" value={meta.author} />
                  <Row label="Asunto" value={meta.subject} />
                  <Row label="Palabras clave" value={meta.keywords} />
                  <Row label="Aplicación" value={meta.creator} />
                  <Row label="Generador (PDF)" value={meta.producer} />
                  <Row label="Creado" value={formatDate(meta.creationDate)} />
                  <Row label="Modificado" value={formatDate(meta.modificationDate)} />
                </dl>
              )}

              <div className="modal-actions">
                <button className="btn" onClick={() => setOpen(false)}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}

/** Fila etiqueta/valor; omite valores vacíos mostrando "—". */
function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value && value.trim() ? value : '—'}</dd>
    </>
  )
}

function pageSizeText(meta: DocumentMetadataDTO): string {
  if (meta.pageSizes.length === 0) return '—'
  if (meta.pageSizes.length === 1) return meta.pageSizes[0].label
  // Varios tamaños distintos: el más común + nº de tamaños.
  return `${meta.pageSizes[0].label} y ${meta.pageSizes.length - 1} más`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
