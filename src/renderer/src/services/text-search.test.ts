import { describe, it, expect } from 'vitest'
import {
  buildSearchIndex,
  findMatches,
  matchRects,
  normalizeQuery,
  segmentRect,
  type PageGeometry,
  type SearchTextItem
} from './text-search'

const item = (str: string, x = 0, y = 0, hasEOL = false): SearchTextItem => ({
  str,
  transform: [10, 0, 0, 10, x, y], // cuerpo 10, horizontal
  width: str.length * 5,
  height: 10,
  hasEOL
})

const search = (items: SearchTextItem[], query: string) =>
  findMatches(buildSearchIndex(items), normalizeQuery(query))

describe('búsqueda en el texto de una página (M6)', () => {
  it('encuentra frases repartidas en varios fragmentos y entre líneas', () => {
    const items = [item('Hola '), item('mun'), item('do', 0, 0, true), item('otra línea')]
    expect(search(items, 'hola mundo')).toEqual([
      [
        { item: 0, from: 0, to: 5 },
        { item: 1, from: 0, to: 3 },
        { item: 2, from: 0, to: 2 }
      ]
    ])
    // El salto de línea cuenta como un espacio (y no se resalta).
    expect(search(items, 'mundo otra')).toEqual([
      [
        { item: 1, from: 0, to: 3 },
        { item: 2, from: 0, to: 2 },
        { item: 3, from: 0, to: 4 }
      ]
    ])
  })

  it('no distingue mayúsculas ni tildes y colapsa los espacios', () => {
    const items = [item('CAMIÓN   rápido'), item('El camion')]
    expect(search(items, 'camión rapido')).toEqual([[{ item: 0, from: 0, to: 15 }]])
    expect(search(items, 'camion')).toHaveLength(2)
    expect(search(items, '  Camión  ')).toHaveLength(2)
  })

  it('las posiciones se refieren al texto original (tildes descompuestas incluidas)', () => {
    const decomposed = 'café solo' // «café» con la tilde como carácter aparte
    expect(search([item(decomposed)], 'solo')).toEqual([[{ item: 0, from: 6, to: 10 }]])
    expect(search([item(decomposed)], 'café')).toEqual([[{ item: 0, from: 0, to: 5 }]])
  })

  it('varias apariciones sin solaparse; consulta vacía = nada', () => {
    expect(search([item('aaaa')], 'aa')).toHaveLength(2)
    expect(search([item('texto')], '   ')).toEqual([])
  })
})

describe('caja del resaltado', () => {
  const measure = (s: string): number => s.length
  const upright: PageGeometry = { width: 200, height: 100, toViewport: (x, y) => [x, 100 - y] }

  it('en una página normal cubre los caracteres buscados', () => {
    const rect = segmentRect(item('abcdef', 20, 50), 2, 4, upright, measure)
    expect(rect.x * 200).toBeCloseTo(30) // 20 + 2 caracteres × 5
    expect(rect.w * 200).toBeCloseTo(10)
    expect(rect.y * 100).toBeCloseTo(100 - 50 - 9) // 0,9 del cuerpo por encima de la base
    expect(rect.h * 100).toBeCloseTo(11)
  })

  it('en una página girada 90° sigue al texto (antes usaba las coordenadas sin girar)', () => {
    // MediaBox 100×200 con /Rotate 90: se ve como 200×100 (como pdf.js).
    const rotated: PageGeometry = { width: 200, height: 100, toViewport: (x, y) => [y, x] }
    const rect = segmentRect(item('abcdef', 20, 50), 2, 4, rotated, measure)
    // El texto horizontal en la página sin girar se ve vertical: x de pantalla = y de la página.
    expect(rect.x * 200).toBeCloseTo(50 - 2)
    expect(rect.w * 200).toBeCloseTo(11)
    expect(rect.y * 100).toBeCloseTo(30)
    expect(rect.h * 100).toBeCloseTo(10)
  })

  it('reparte el ancho según lo que mide cada carácter', () => {
    const wide = (s: string): number => [...s].reduce((sum, ch) => sum + (ch === 'W' ? 3 : 1), 0)
    const words = { ...item('iiWW', 0, 50), width: 80 } // i = 10, W = 30
    const rect = segmentRect(words, 2, 4, upright, wide)
    expect(rect.x * 200).toBeCloseTo(20) // tras «ii»
    expect(rect.w * 200).toBeCloseTo(60) // «WW»
  })
})

describe('una caja por línea', () => {
  const measure = (): ((s: string) => number) => (s) => s.length
  const page: PageGeometry = { width: 200, height: 100, toViewport: (x, y) => [x, 100 - y] }

  it('une los fragmentos de una misma línea y separa las líneas', () => {
    const items = [item('Hola ', 10, 80), item('mundo', 35, 80, true), item('adiós', 10, 60)]
    const [match] = findMatches(buildSearchIndex(items), normalizeQuery('hola mundo adiós'))
    const rects = matchRects(match, items, page, measure)
    expect(rects).toHaveLength(2)
    expect(rects[0].x * 200).toBeCloseTo(10)
    expect(rects[0].w * 200).toBeCloseTo(50) // «Hola » + «mundo», sin costura
  })

  it('no une dos columnas que están a la misma altura', () => {
    const items = [item('fin de ', 10, 80), item('columna', 150, 80)]
    const [match] = findMatches(buildSearchIndex(items), normalizeQuery('de columna'))
    expect(matchRects(match, items, page, measure)).toHaveLength(2)
  })
})
