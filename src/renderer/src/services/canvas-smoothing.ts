/**
 * pdf.js desactiva el suavizado al AMPLIAR imágenes sin /Interpolate (casi todas):
 * las dibuja por «vecino más próximo» y, al hacer zoom, se ven en escalera. Lo
 * dejamos siempre activo y en calidad alta, como Vista Previa o Acrobat. Las
 * asignaciones posteriores de pdf.js a `imageSmoothingEnabled` se ignoran.
 */
export function keepImagesSmooth(context: CanvasRenderingContext2D): void {
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  if (Object.prototype.hasOwnProperty.call(context, 'imageSmoothingEnabled')) return
  Object.defineProperty(context, 'imageSmoothingEnabled', {
    configurable: true,
    get: () => true,
    set: () => {}
  })
}
