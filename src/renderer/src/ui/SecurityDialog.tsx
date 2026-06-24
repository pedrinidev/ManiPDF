import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { Icon } from './Icon'
import { useDocument } from '../state/document.store'
import { securityClient } from '../services/security.client'
import { ClientError } from '../services/document.client'

/** Longitud mínima de la contraseña de apertura. */
const MIN_PASSWORD_LENGTH = 6

/**
 * Botón "Proteger" + modal para cifrar el PDF con contraseña y permisos.
 * Exporta una copia protegida a disco (no altera el documento abierto).
 */
export function SecurityDialog(): JSX.Element {
  const { state, reportError } = useDocument()
  const hasDoc = !!state.doc

  const [open, setOpen] = useState(false)
  const [userPassword, setUserPassword] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [showUser, setShowUser] = useState(false)
  const [showOwner, setShowOwner] = useState(false)
  const [printing, setPrinting] = useState(true)
  const [copying, setCopying] = useState(true)
  const [modifying, setModifying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const tooShort = userPassword.trim().length < MIN_PASSWORD_LENGTH

  const reset = (): void => {
    setUserPassword('')
    setOwnerPassword('')
    setShowUser(false)
    setShowOwner(false)
    setPrinting(true)
    setCopying(true)
    setModifying(false)
    setSavedPath(null)
  }

  const close = (): void => {
    setOpen(false)
    reset()
  }

  const submit = async (): Promise<void> => {
    if (!state.doc || tooShort) return
    setBusy(true)
    setSavedPath(null)
    try {
      const filePath = await securityClient.protect(state.doc.id, {
        userPassword: userPassword.trim(),
        ownerPassword: ownerPassword.trim() || undefined,
        permissions: { printing, copying, modifying }
      })
      setSavedPath(filePath)
    } catch (err) {
      if (!(err instanceof ClientError && err.isCancellation)) {
        reportError(err instanceof Error ? err.message : 'Error al proteger el PDF')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} disabled={!hasDoc}>
        Proteger
      </button>

      {open && (
        <Portal>
        <div className="modal-backdrop" onMouseDown={bumpModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Proteger con contraseña</h3>

            {savedPath ? (
              <div className="modal-success">
                <span>✅ PDF protegido guardado en:</span>
                <code>{savedPath}</code>
                <button className="btn" onClick={() => window.api.app.reveal(savedPath)}>
                  Mostrar en carpeta
                </button>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Contraseña de apertura *</span>
                  <div className="password-input">
                    <input
                      type={showUser ? 'text' : 'password'}
                      value={userPassword}
                      autoFocus
                      onChange={(e) => setUserPassword(e.target.value)}
                      placeholder="Necesaria para abrir el PDF"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowUser((v) => !v)}
                      title={showUser ? 'Ocultar' : 'Mostrar'}
                      aria-label={showUser ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      <Icon name={showUser ? 'eye-off' : 'eye'} size={16} />
                    </button>
                  </div>
                  <small className={tooShort && userPassword.length > 0 ? 'password-hint warn' : 'password-hint'}>
                    Mínimo {MIN_PASSWORD_LENGTH} caracteres.
                  </small>
                </label>

                <label className="field">
                  <span>Contraseña de propietario (opcional)</span>
                  <div className="password-input">
                    <input
                      type={showOwner ? 'text' : 'password'}
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      placeholder="Para cambiar permisos (si se deja vacía, = apertura)"
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowOwner((v) => !v)}
                      title={showOwner ? 'Ocultar' : 'Mostrar'}
                      aria-label={showOwner ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    >
                      <Icon name={showOwner ? 'eye-off' : 'eye'} size={16} />
                    </button>
                  </div>
                </label>

                <fieldset className="permissions">
                  <legend>Permisos del lector</legend>
                  <label>
                    <input type="checkbox" checked={printing} onChange={(e) => setPrinting(e.target.checked)} />
                    Permitir imprimir
                  </label>
                  <label>
                    <input type="checkbox" checked={copying} onChange={(e) => setCopying(e.target.checked)} />
                    Permitir copiar texto
                  </label>
                  <label>
                    <input type="checkbox" checked={modifying} onChange={(e) => setModifying(e.target.checked)} />
                    Permitir modificar
                  </label>
                </fieldset>
              </>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={close}>
                {savedPath ? 'Cerrar' : 'Cancelar'}
              </button>
              {!savedPath && (
                <button
                  className="btn primary"
                  onClick={submit}
                  disabled={busy || tooShort}
                >
                  {busy ? 'Cifrando…' : 'Proteger y guardar'}
                </button>
              )}
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}
