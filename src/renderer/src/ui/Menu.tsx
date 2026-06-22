import { useState, type JSX, type ReactNode } from 'react'

/**
 * Menú desplegable de la barra. El panel se mantiene SIEMPRE montado y solo se
 * oculta por CSS (clase `.open`): así los diálogos que contiene conservan su
 * estado y sus modales (renderizados con Portal) siguen vivos al cerrar el menú.
 */
export function Menu({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="menu">
      <button className={`btn menu-trigger${open ? ' active' : ''}`} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && <div className="menu-backdrop" onClick={() => setOpen(false)} />}
      <div className={`menu-panel${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
        {children}
      </div>
    </div>
  )
}
