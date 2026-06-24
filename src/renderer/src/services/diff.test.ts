import { describe, it, expect } from 'vitest'
import { lineDiff } from './diff'

describe('lineDiff', () => {
  it('marca todo igual cuando los textos coinciden', () => {
    const ops = lineDiff(['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(ops.every((o) => o.type === 'same')).toBe(true)
    expect(ops.map((o) => o.text)).toEqual(['a', 'b', 'c'])
  })

  it('detecta una línea añadida', () => {
    const ops = lineDiff(['a', 'c'], ['a', 'b', 'c'])
    expect(ops).toEqual([
      { type: 'same', text: 'a' },
      { type: 'add', text: 'b' },
      { type: 'same', text: 'c' }
    ])
  })

  it('detecta una línea eliminada', () => {
    const ops = lineDiff(['a', 'b', 'c'], ['a', 'c'])
    expect(ops).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' }
    ])
  })

  it('una sustitución es del + add', () => {
    const ops = lineDiff(['hola'], ['adios'])
    expect(ops).toContainEqual({ type: 'del', text: 'hola' })
    expect(ops).toContainEqual({ type: 'add', text: 'adios' })
  })

  it('A vacío → todo añadido; B vacío → todo eliminado', () => {
    expect(lineDiff([], ['x', 'y'])).toEqual([
      { type: 'add', text: 'x' },
      { type: 'add', text: 'y' }
    ])
    expect(lineDiff(['x', 'y'], [])).toEqual([
      { type: 'del', text: 'x' },
      { type: 'del', text: 'y' }
    ])
  })
})
