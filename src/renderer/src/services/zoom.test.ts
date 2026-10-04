import { describe, it, expect } from 'vitest'
import { clampZoom, nextZoom, zoomActionForKey, zoomFromWheel, MAX_ZOOM, MIN_ZOOM } from './zoom'

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods
})

describe('zoomActionForKey', () => {
  it('reconoce Cmd/Ctrl + «+» / «=» / «−» / «0»', () => {
    expect(zoomActionForKey(key('+', { metaKey: true }))).toBe('in')
    expect(zoomActionForKey(key('=', { metaKey: true }))).toBe('in')
    expect(zoomActionForKey(key('-', { ctrlKey: true }))).toBe('out')
    expect(zoomActionForKey(key('_', { ctrlKey: true }))).toBe('out')
    expect(zoomActionForKey(key('0', { metaKey: true }))).toBe('reset')
  })

  it('ignora teclas sin Cmd/Ctrl, con Alt o que no son de zoom', () => {
    expect(zoomActionForKey(key('+'))).toBeNull()
    expect(zoomActionForKey(key('+', { metaKey: true, altKey: true }))).toBeNull()
    expect(zoomActionForKey(key('s', { metaKey: true }))).toBeNull()
  })
})

describe('nextZoom / clampZoom', () => {
  it('acerca y aleja en pasos del 25 % dentro de los límites', () => {
    expect(nextZoom(1, 'in')).toBe(1.25)
    expect(nextZoom(1, 'out')).toBe(0.75)
    expect(nextZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM)
    expect(nextZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM)
    expect(nextZoom(2.5, 'reset')).toBe(1)
  })

  it('redondea a centésimas', () => {
    expect(clampZoom(1.2499999)).toBe(1.25)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
  })
})

describe('zoomFromWheel (pellizco / Ctrl + rueda)', () => {
  it('delta negativo acerca, positivo aleja, en pasos del 5 %', () => {
    const acercado = zoomFromWheel(1, -60)
    const alejado = zoomFromWheel(1, 60)
    expect(acercado).toBeGreaterThan(1)
    expect(alejado).toBeLessThan(1)
    expect(Math.round(acercado * 100) % 5).toBe(0)
  })

  it('deltas pequeños no cambian el zoom (se acumulan fuera)', () => {
    expect(zoomFromWheel(1, -2)).toBe(1)
  })

  it('respeta los límites', () => {
    expect(zoomFromWheel(MAX_ZOOM, -1000)).toBe(MAX_ZOOM)
    expect(zoomFromWheel(MIN_ZOOM, 1000)).toBe(MIN_ZOOM)
  })
})
