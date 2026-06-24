import type { MouseEvent } from 'react'

/**
 * Feedback al pulsar FUERA de un diálogo modal: en vez de cerrarlo (lo que hacía
 * perder el trabajo), reproduce el sonido de alerta del sistema y "sacude" el
 * diálogo para llamar la atención — como en Acrobat / los modales de Windows.
 *
 * Se engancha al `onMouseDown` del `.modal-backdrop`; solo actúa si el clic fue
 * en el fondo (no dentro del `.modal`).
 */
export function bumpModal(e: MouseEvent<HTMLElement>): void {
  if (e.target !== e.currentTarget) return // clic dentro del modal → ignorar
  window.api.app.beep()
  const modal = e.currentTarget.querySelector<HTMLElement>('.modal')
  if (!modal) return
  modal.classList.remove('shake')
  void modal.offsetWidth // reinicia la animación si ya estaba aplicada
  modal.classList.add('shake')
}
