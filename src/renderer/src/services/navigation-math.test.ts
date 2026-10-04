import { describe, it, expect } from 'vitest'
import { clampPage, pageIndexAt, parsePageInput } from './navigation-math'

describe('clampPage', () => {
  it('limita al rango 1..pageCount', () => {
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(-5, 10)).toBe(1)
    expect(clampPage(7, 10)).toBe(7)
    expect(clampPage(999, 10)).toBe(10)
  })

  it('redondea y tolera documentos sin páginas', () => {
    expect(clampPage(3.6, 10)).toBe(4)
    expect(clampPage(5, 0)).toBe(1)
  })
})

describe('parsePageInput', () => {
  it('acepta números (con espacios) y los ajusta al documento', () => {
    expect(parsePageInput('32', 120)).toBe(32)
    expect(parsePageInput('  32 ', 120)).toBe(32)
    expect(parsePageInput('999', 120)).toBe(120)
    expect(parsePageInput('0', 120)).toBe(1)
  })

  it('rechaza lo que no es un entero positivo', () => {
    expect(parsePageInput('', 120)).toBeNull()
    expect(parsePageInput('abc', 120)).toBeNull()
    expect(parsePageInput('3.5', 120)).toBeNull()
    expect(parsePageInput('-2', 120)).toBeNull()
  })
})

describe('pageIndexAt', () => {
  // 4 páginas de 100 px de alto con huecos de 20 px: [0-100] [120-220] [240-340] [360-460]
  const spans = [0, 1, 2, 3].map((i) => ({ top: i * 120, bottom: i * 120 + 100 }))
  const spanAt = (i: number): { top: number; bottom: number } => spans[i]

  it('devuelve la página que contiene la línea de referencia', () => {
    expect(pageIndexAt(4, spanAt, 0)).toBe(0)
    expect(pageIndexAt(4, spanAt, 50)).toBe(0)
    expect(pageIndexAt(4, spanAt, 130)).toBe(1)
    expect(pageIndexAt(4, spanAt, 455)).toBe(3)
  })

  it('en el hueco entre páginas elige la siguiente', () => {
    expect(pageIndexAt(4, spanAt, 110)).toBe(1)
    expect(pageIndexAt(4, spanAt, 230)).toBe(2)
  })

  it('por encima de todo → primera; por debajo de todo → última', () => {
    expect(pageIndexAt(4, spanAt, -500)).toBe(0)
    expect(pageIndexAt(4, spanAt, 10_000)).toBe(3)
  })

  it('lee pocas posiciones (búsqueda binaria)', () => {
    let reads = 0
    const many = (i: number): { top: number; bottom: number } => {
      reads++
      return { top: i * 120, bottom: i * 120 + 100 }
    }
    expect(pageIndexAt(1000, many, 500 * 120 + 50)).toBe(500)
    expect(reads).toBeLessThanOrEqual(11)
  })

  it('sin páginas devuelve 0', () => {
    expect(pageIndexAt(0, spanAt, 10)).toBe(0)
  })
})
