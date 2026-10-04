import { describe, it, expect } from 'vitest'
import {
  dropSide,
  moveIndex,
  selectionAfterDuplicate,
  selectionAfterInsert,
  selectionAfterReorder
} from './page-order'

describe('moveIndex (arrastrar miniaturas)', () => {
  it('soltar sobre la página siguiente la intercambia (antes no hacía nada)', () => {
    expect(moveIndex(3, 0, 1)).toEqual([1, 0, 2])
    expect(moveIndex(3, 1, 2)).toEqual([0, 2, 1])
  })

  it('se puede mover a la última posición', () => {
    expect(moveIndex(3, 0, 2)).toEqual([1, 2, 0])
    expect(moveIndex(5, 1, 4)).toEqual([0, 2, 3, 4, 1])
  })

  it('hacia arriba ocupa la posición de destino', () => {
    expect(moveIndex(3, 2, 0)).toEqual([2, 0, 1])
    expect(moveIndex(5, 4, 1)).toEqual([0, 4, 1, 2, 3])
  })

  it('siempre devuelve una permutación completa', () => {
    for (let from = 0; from < 6; from++) {
      for (let to = 0; to < 6; to++) {
        expect([...moveIndex(6, from, to)].sort()).toEqual([0, 1, 2, 3, 4, 5])
        expect(moveIndex(6, from, to)[to]).toBe(from)
      }
    }
  })
})

describe('dropSide', () => {
  it('indica si la página quedará antes o después del destino', () => {
    expect(dropSide(4, 1)).toBe('before')
    expect(dropSide(1, 4)).toBe('after')
    expect(dropSide(2, 2)).toBeNull()
  })
})

describe('selección tras operar con páginas', () => {
  it('al reordenar, la selección sigue a sus páginas', () => {
    // Se arrastra la 1.ª al final: la que estaba seleccionada (índice 1) pasa a ser la 0.
    expect(selectionAfterReorder([1], moveIndex(4, 0, 3))).toEqual([0])
    expect(selectionAfterReorder([0, 3], moveIndex(4, 0, 3))).toEqual([2, 3])
  })

  it('al duplicar quedan seleccionadas las copias (cada una tras su original)', () => {
    // Páginas 0 y 2 → [0, 0', 1, 2, 2'] → copias en 1 y 4.
    expect(selectionAfterDuplicate([2, 0])).toEqual([1, 4])
  })

  it('al insertar quedan seleccionadas las páginas nuevas', () => {
    expect(selectionAfterInsert(3, 2)).toEqual([3, 4])
    expect(selectionAfterInsert(0, 0)).toEqual([])
  })
})
