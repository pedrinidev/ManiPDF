import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renderiza su contenido en <body>, fuera del árbol del componente. Lo usan los
 * modales para que no los oculte un ancestro con display:none (p. ej. un menú
 * cerrado por CSS) ni los recorte un overflow.
 */
export function Portal({ children }: { children: ReactNode }): ReturnType<typeof createPortal> {
  return createPortal(children, document.body)
}
