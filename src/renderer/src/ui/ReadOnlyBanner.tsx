import { useState, type FormEvent, type JSX } from 'react'
import { Portal } from './Portal'
import { bumpModal } from './modal-attention'
import { useDocument } from '../state/document.store'
import { documentClient, ClientError } from '../services/document.client'

const MESSAGES = {
  restricted: 'Este PDF tiene restricciones de su autor: puedes verlo e imprimirlo según sus permisos, pero no modificarlo.',
  undecryptable: 'Este PDF está protegido con un cifrado que ManiPDF no ha podido descifrar: solo puede verse.'
} as const

/**
 * Aviso de documento de solo lectura (PDF protegido que no se ha podido descifrar
 * para editarlo). Los PDF con restricciones se pueden desbloquear con la
 * contraseña de PROPIETARIO. Los que piden contraseña de apertura no llegan aquí:
 * el visor la solicita directamente.
 */
export function ReadOnlyBanner(): JSX.Element | null {
  const { state, replaceDoc } = useDocument()
  const doc = state.doc
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!doc || (doc.readOnly !== 'restricted' && doc.readOnly !== 'undecryptable')) return null

  const close = (): void => {
    setOpen(false)
    setPassword('')
    setError(null)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    setError(null)
    try {
      replaceDoc(await documentClient.unlock(doc.id, password))
      close()
    } catch (err) {
      setError(
        err instanceof ClientError && err.code === 'WRONG_PASSWORD'
          ? 'Esa no es la contraseña de propietario.'
          : err instanceof Error
            ? err.message
            : 'No se pudo desbloquear el documento.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="readonly-banner">
      <span className="readonly-banner-text">🔒 {MESSAGES[doc.readOnly]}</span>
      {doc.readOnly === 'restricted' && (
        <button className="btn" onClick={() => setOpen(true)}>
          Desbloquear…
        </button>
      )}

      {open && (
        <Portal>
          <div className="modal-backdrop" onMouseDown={bumpModal}>
            <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
              <h3>Desbloquear para editar</h3>
              <p className="conv-hint">
                Introduce la contraseña de <strong>propietario</strong> del PDF. Al guardar, el
                archivo conservará sus restricciones.
              </p>
              <label className="field">
                <span>Contraseña de propietario</span>
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && <p className="password-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={close}>
                  Cancelar
                </button>
                <button type="submit" className="btn primary" disabled={busy || !password}>
                  {busy ? 'Comprobando…' : 'Desbloquear'}
                </button>
              </div>
            </form>
          </div>
        </Portal>
      )}
    </div>
  )
}
