import { useState, type JSX } from 'react'
import { Portal } from './Portal'
import { useDocument } from '../state/document.store'
import { securityClient } from '../services/security.client'
import { ClientError } from '../services/document.client'

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
  const [printing, setPrinting] = useState(true)
  const [copying, setCopying] = useState(true)
  const [modifying, setModifying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const reset = (): void => {
    setUserPassword('')
    setOwnerPassword('')
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
    if (!state.doc || !userPassword.trim()) return
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
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Proteger con contraseña</h3>

            {savedPath ? (
              <div className="modal-success">
                ✅ PDF protegido guardado en:
                <code>{savedPath}</code>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Contraseña de apertura *</span>
                  <input
                    type="password"
                    value={userPassword}
                    autoFocus
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Necesaria para abrir el PDF"
                  />
                </label>

                <label className="field">
                  <span>Contraseña de propietario (opcional)</span>
                  <input
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="Para cambiar permisos (si se deja vacía, = apertura)"
                  />
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
                  disabled={busy || !userPassword.trim()}
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
