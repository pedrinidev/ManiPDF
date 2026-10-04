import { describe, it, expect } from 'vitest'
import { limitPlateCache } from './separation-utils'

const cacheOf = (pages: number[]): Map<number, string> => new Map(pages.map((p) => [p, `planchas ${p}`]))

describe('limitPlateCache (memoria de la separación de color)', () => {
  it('por debajo del límite no descarta nada', () => {
    expect([...limitPlateCache(cacheOf([1, 2, 3]), 3, new Map(), 6).keys()]).toEqual([1, 2, 3])
  })

  it('descarta las páginas más alejadas de la recién separada', () => {
    const kept = limitPlateCache(cacheOf([1, 2, 3, 10, 11, 12, 13]), 13, new Map(), 4)
    expect([...kept.keys()].sort((a, b) => a - b)).toEqual([10, 11, 12, 13])
  })

  it('nunca descarta páginas montadas en el visor (evita regenerarlas en bucle)', () => {
    const mounted = new Map([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1]
    ])
    const kept = limitPlateCache(cacheOf([1, 2, 3, 4, 5, 20]), 5, mounted, 3)
    expect([...kept.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })
})
