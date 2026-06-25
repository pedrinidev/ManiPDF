import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import logoUrl from '../assets/logo.svg'

/** Versión mostrada (mantener en sync con package.json). */
const APP_VERSION = '0.1.7'
const YOUTUBE_URL = 'https://www.youtube.com/channel/UCjV6RzAUBtA1gDnccxa8-uA'

/**
 * "Acerca de ManiPDF": botón en la barra (entre Herramientas y el icono de
 * información) que abre un modal con la descripción de la app, sus funciones y un
 * acceso al manual de usuario.
 */
export function AboutDialog(): JSX.Element {
  const { openManual, reportError } = useDocument()
  const [open, setOpen] = useState(false)

  const openTheManual = async (): Promise<void> => {
    setOpen(false)
    const path = await window.api.app.manualPath()
    if (path) await openManual(path)
    else reportError('No se encontró el manual de usuario.')
  }

  return (
    <>
      <button className="btn menu-trigger" onClick={() => setOpen(true)}>
        Acerca de
      </button>

      {open && (
        <Portal>
          <div className="modal-backdrop" onMouseDown={bumpModal}>
            <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
              <div className="about-head">
                <img src={logoUrl} alt="ManiPDF" width={64} height={64} className="about-logo" />
                <div>
                  <h3 className="about-title">ManiPDF</h3>
                  <span className="about-version">Versión {APP_VERSION}</span>
                </div>
              </div>

              <p className="about-desc">
                Editor de PDF de escritorio: ver, anotar, organizar páginas, formularios, proteger,
                comprimir, comparar, OCR y separación de color, en una interfaz sencilla.
              </p>

              <p className="about-credits">
                Incluye Ghostscript (© Artifex Software), bajo licencia AGPL v3 —{' '}
                <a href="https://www.ghostscript.com/" target="_blank" rel="noreferrer">
                  código y licencia
                </a>
                . También usa pdf.js, pdf-lib y Tesseract.
              </p>

              <div className="about-grid">
                <span>Desarrollado por</span>
                <strong>PedriniDev</strong>
                <span>Tecnología</span>
                <strong>Electron · React · TypeScript · pdf.js</strong>
                <span>Licencia</span>
                <strong>Uso personal</strong>
                <span>YouTube</span>
                <a href={YOUTUBE_URL} target="_blank" rel="noreferrer">
                  Canal de PedriniDev
                </a>
              </div>

              <div className="modal-actions">
                <button className="btn" onClick={() => setOpen(false)}>
                  Cerrar
                </button>
                <button className="btn primary" onClick={openTheManual}>
                  Abrir manual de usuario
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
