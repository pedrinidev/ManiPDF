import { describe, it, expect } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildMenuTemplate } from './menu'

/** Todos los roles de la plantilla, aplanados. */
function roles(template: MenuItemConstructorOptions[]): string[] {
  const out: string[] = []
  const walk = (items: MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      if (item.role) out.push(item.role.toLowerCase())
      if (Array.isArray(item.submenu)) walk(item.submenu)
    }
  }
  walk(template)
  return out
}

describe('buildMenuTemplate', () => {
  it('Windows y Linux: sin menú nativo', () => {
    expect(buildMenuTemplate('win32', true, 'ManiPDF')).toBeNull()
    expect(buildMenuTemplate('linux', true, 'ManiPDF')).toBeNull()
  })

  it('macOS instalado: sin recargar, zoom de Chromium, cerrar ventana ni devtools', () => {
    const r = roles(buildMenuTemplate('darwin', true, 'ManiPDF')!)
    for (const forbidden of ['reload', 'forcereload', 'toggledevtools', 'zoomin', 'zoomout', 'resetzoom', 'close']) {
      expect(r).not.toContain(forbidden)
    }
  })

  it('macOS: conserva salir y la edición de texto (copiar/pegar/deshacer)', () => {
    const r = roles(buildMenuTemplate('darwin', true, 'ManiPDF')!)
    for (const needed of ['quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'selectall']) {
      expect(r).toContain(needed)
    }
  })

  it('macOS en desarrollo: añade recargar y herramientas de desarrollo', () => {
    const r = roles(buildMenuTemplate('darwin', false, 'ManiPDF')!)
    expect(r).toContain('reload')
    expect(r).toContain('toggledevtools')
  })
})
