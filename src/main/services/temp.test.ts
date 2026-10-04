import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeStaleTempDirs } from './temp'

describe('temporales de ejecuciones anteriores', () => {
  it('borra solo las carpetas propias y antiguas', async () => {
    const base = await mkdtemp(join(tmpdir(), 'manipdf-test-base-'))
    try {
      const old = new Date(Date.now() - 3_600_000)
      for (const name of ['manipdf-dec-Ab12Cd', 'pdfprint-Zx98Yw', 'manipdf-print-new111', 'otraapp-Qw12Er']) {
        await mkdir(join(base, name))
        await writeFile(join(base, name, 'document.pdf'), 'contenido descifrado')
        if (name !== 'manipdf-print-new111') await utimes(join(base, name), old, old)
      }
      await writeFile(join(base, 'manipdf-dec-Fi1e00'), 'un archivo, no una carpeta')
      await utimes(join(base, 'manipdf-dec-Fi1e00'), old, old)

      expect(await removeStaleTempDirs({ base })).toBe(2)
      expect((await readdir(base)).sort()).toEqual(['manipdf-dec-Fi1e00', 'manipdf-print-new111', 'otraapp-Qw12Er'])
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
