import type { MenuItemConstructorOptions } from 'electron'

/**
 * Plantilla del menú de aplicación nativo.
 *
 * - Windows/Linux: sin menú nativo (null). La app dibuja su propio menú y el de
 *   Electron se pintaría dentro de la ventana, duplicado.
 * - macOS: menú propio EN LUGAR del de Electron por defecto, que traía «Recargar»
 *   (Cmd+R recargaba la interfaz y se perdía lo no guardado), el zoom de Chromium
 *   (Cmd +/− estiraba la página ya pintada en vez de usar el zoom del visor),
 *   «Cerrar ventana» con Cmd+W (que la app usa para cerrar la pestaña), las
 *   herramientas de desarrollo y una ayuda que enlazaba a electronjs.org.
 *   El menú Edición es imprescindible: sin él no funcionan copiar/pegar/deshacer
 *   en los campos de texto.
 *
 * Es una función pura (sin efectos) para poder testearla.
 */
export function buildMenuTemplate(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  appName: string
): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null

  const template: MenuItemConstructorOptions[] = [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `Acerca de ${appName}` },
        { type: 'separator' },
        { role: 'services', label: 'Servicios' },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${appName}` },
        { role: 'hideOthers', label: 'Ocultar otros' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: `Salir de ${appName}` }
      ]
    },
    {
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ventana',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { type: 'separator' },
        { role: 'front', label: 'Traer todo al frente' }
      ]
    }
  ]

  // Solo en desarrollo: recargar y herramientas de desarrollo.
  if (!isPackaged) {
    template.push({
      label: 'Desarrollo',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }]
    })
  }
  return template
}
