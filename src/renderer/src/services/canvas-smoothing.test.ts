import { describe, it, expect } from 'vitest'
import { keepImagesSmooth } from './canvas-smoothing'

/** Imita un CanvasRenderingContext2D: la propiedad es un accessor del prototipo. */
class FakeContext {
  private smoothing = true
  imageSmoothingQuality: ImageSmoothingQuality = 'low'
  get imageSmoothingEnabled(): boolean {
    return this.smoothing
  }
  set imageSmoothingEnabled(value: boolean) {
    this.smoothing = value
  }
}

describe('keepImagesSmooth', () => {
  it('fija el suavizado aunque pdf.js intente desactivarlo al ampliar', () => {
    const ctx = new FakeContext() as unknown as CanvasRenderingContext2D
    keepImagesSmooth(ctx)
    ctx.imageSmoothingEnabled = false
    expect(ctx.imageSmoothingEnabled).toBe(true)
    expect(ctx.imageSmoothingQuality).toBe('high')
  })

  it('se puede volver a aplicar (tras redimensionar el canvas) sin fallar', () => {
    const ctx = new FakeContext() as unknown as CanvasRenderingContext2D
    keepImagesSmooth(ctx)
    ctx.imageSmoothingQuality = 'low' // un resize restablece la calidad
    keepImagesSmooth(ctx)
    expect(ctx.imageSmoothingQuality).toBe('high')
    expect(ctx.imageSmoothingEnabled).toBe(true)
  })
})
