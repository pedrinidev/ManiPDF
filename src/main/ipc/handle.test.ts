import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { handleExclusive } from './handle'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('handleExclusive (una operación a la vez por documento)', () => {
  it('las operaciones del mismo documento no se solapan y respetan el orden', async () => {
    const events: string[] = []
    const op = (name: string, ms: number) => async (): Promise<string> => {
      events.push(`inicio ${name}`)
      await sleep(ms)
      events.push(`fin ${name}`)
      return name
    }
    const [a, b] = await Promise.all([handleExclusive('doc', op('A', 30)), handleExclusive('doc', op('B', 1))])
    expect(a).toEqual({ ok: true, data: 'A' })
    expect(b).toEqual({ ok: true, data: 'B' })
    expect(events).toEqual(['inicio A', 'fin A', 'inicio B', 'fin B'])
  })

  it('documentos distintos no se esperan entre sí', async () => {
    const events: string[] = []
    await Promise.all([
      handleExclusive('uno', async () => {
        events.push('inicio uno')
        await sleep(30)
        events.push('fin uno')
      }),
      handleExclusive('dos', async () => {
        events.push('inicio dos')
        events.push('fin dos')
      })
    ])
    expect(events.indexOf('fin dos')).toBeLessThan(events.indexOf('fin uno'))
  })

  it('un error no bloquea la cola', async () => {
    const failed = handleExclusive('doc', () => {
      throw new Error('falla')
    })
    const next = handleExclusive('doc', () => 'sigue')
    expect((await failed).ok).toBe(false)
    expect(await next).toEqual({ ok: true, data: 'sigue' })
  })
})
