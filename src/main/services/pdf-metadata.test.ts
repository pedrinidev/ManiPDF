import { describe, it, expect } from 'vitest'
import {
  countColorMarkers,
  detectPdfVersion,
  detectColorLabel,
  groupPageSizes,
  sizeLabel
} from './pdf-metadata'

const b = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('detectPdfVersion', () => {
  it('lee la versión del encabezado', () => {
    expect(detectPdfVersion(b('%PDF-1.7\n...'))).toBe('1.7')
  })
  it('devuelve null si no hay encabezado válido', () => {
    expect(detectPdfVersion(b('no es un pdf'))).toBeNull()
  })
})

describe('countColorMarkers', () => {
  it('cuenta una sola vez los marcadores partidos entre trozos o en el solape', () => {
    // Trozos de 8 bytes: «DeviceCMYK» empieza en el 5 y cruza al segundo trozo.
    expect(countColorMarkers(b('.....DeviceCMYK.... /DeviceRGB'), 8)).toEqual({ cmyk: 1, rgb: 1, gray: 0 })
    expect(countColorMarkers(b('/N 4 /N 3 /N 1 /DeviceGray'), 4)).toEqual({ cmyk: 1, rgb: 1, gray: 2 })
  })

  it('funciona con una vista sobre un buffer mayor', () => {
    const whole = b('xxxx/DeviceCMYKyyyy')
    expect(countColorMarkers(whole.subarray(4, 15), 3)).toEqual({ cmyk: 1, rgb: 0, gray: 0 })
  })
})

describe('detectColorLabel', () => {
  it('CMYK', () => expect(detectColorLabel(b('/DeviceCMYK'))).toBe('Color (CMYK)'))
  it('RGB', () => expect(detectColorLabel(b('/DeviceRGB'))).toBe('Color (RGB)'))
  it('RGB + CMYK', () =>
    expect(detectColorLabel(b('/DeviceRGB /DeviceCMYK'))).toBe('Color (RGB + CMYK)'))
  it('grises', () => expect(detectColorLabel(b('/DeviceGray'))).toBe('Escala de grises'))
  it('no determinado', () => expect(detectColorLabel(b('sin color'))).toBe('No determinado'))
})

describe('sizeLabel', () => {
  it('reconoce Carta (con tolerancia y orientación)', () => {
    expect(sizeLabel(612, 792)).toContain('Carta')
    expect(sizeLabel(792, 612)).toContain('Carta') // apaisado
  })
  it('reconoce A4', () => expect(sizeLabel(595.28, 841.89)).toContain('A4'))
  it('tamaño desconocido: solo cm, sin nombre', () => {
    const label = sizeLabel(500, 700)
    expect(label).toMatch(/cm$/)
    expect(label).not.toContain('·')
  })
})

describe('groupPageSizes', () => {
  it('agrupa páginas iguales y ordena por frecuencia', () => {
    const groups = groupPageSizes([
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 595.28, height: 841.89 }
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].count).toBe(2) // Carta, el más común, primero
    expect(groups[0].label).toContain('Carta')
    expect(groups[1].count).toBe(1)
  })
})
