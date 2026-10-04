import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { imagePageLayout } from './convert.service'

describe('imágenes → PDF: tamaño de página', () => {
  it('Carta y A4 se orientan como la imagen y la centran', () => {
    const letter = imagePageLayout(3000, 2000, 'letter') // apaisada
    expect([letter.pageWidth, letter.pageHeight]).toEqual([792, 612])
    expect(letter.width / letter.height).toBeCloseTo(1.5)
    expect(letter.y).toBeCloseTo((612 - letter.height) / 2)

    const a4 = imagePageLayout(1000, 2000, 'a4') // vertical
    expect([a4.pageWidth, a4.pageHeight]).toEqual([595.28, 841.89])
    expect(a4.height).toBeCloseTo(841.89)
    expect(a4.x).toBeCloseTo((595.28 - a4.width) / 2)
  })

  it('«tamaño de la imagen»: 72 ppp sin márgenes, como mucho un A4', () => {
    expect(imagePageLayout(300, 200, 'image')).toEqual({ pageWidth: 300, pageHeight: 200, x: 0, y: 0, width: 300, height: 200 })
    const big = imagePageLayout(3000, 2000, 'image')
    expect(big.pageWidth).toBeCloseTo(841.89) // apaisada: el lado largo de un A4
    expect(big.pageHeight).toBeCloseTo(841.89 / 1.5)
  })
})
