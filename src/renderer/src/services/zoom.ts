/** Límites y pasos del zoom del visor (lógica pura, sin DOM). */
export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4
export const ZOOM_STEP = 0.25

export type ZoomAction = 'in' | 'out' | 'reset'

/** Limita el zoom al rango permitido y lo redondea a centésimas (sin 1.2499999). */
export function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100
}

/** Zoom resultante de aplicar una acción (acercar / alejar / 100 %). */
export function nextZoom(zoom: number, action: ZoomAction): number {
  if (action === 'reset') return 1
  return clampZoom(action === 'in' ? zoom + ZOOM_STEP : zoom - ZOOM_STEP)
}

/**
 * Atajo de teclado de zoom: Cmd/Ctrl + «+» (o «=», misma tecla sin Mayús en
 * teclados US), «−» y «0». Devuelve null si la tecla no es un atajo de zoom.
 */
export function zoomActionForKey(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}): ZoomAction | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
  switch (e.key) {
    case '+':
    case '=':
      return 'in'
    case '-':
    case '_':
      return 'out'
    case '0':
      return 'reset'
    default:
      return null
  }
}

/**
 * Zoom tras un gesto de rueda con Ctrl o de pellizco en el trackpad (Chromium lo
 * entrega como rueda con `ctrlKey`). `deltaY` negativo acerca. Se ajusta a pasos
 * del 5 % para que el porcentaje mostrado sea limpio.
 */
export function zoomFromWheel(zoom: number, deltaY: number): number {
  const factor = Math.exp(-deltaY / 300)
  return clampZoom(Math.round(zoom * factor * 20) / 20)
}
