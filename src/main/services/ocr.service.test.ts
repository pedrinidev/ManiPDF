import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { OcrService } from './ocr.service'
import { DocumentService } from './document.service'
import { FileService } from './file.service'

describe('OCR sin conexión (A5)', () => {
  it('da un error comprensible y no una excepción no capturada en el proceso principal', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'manipdf-tess-'))
    const files = new FileService()
    try {
      // Origen de modelos inaccesible = como estar sin internet y sin caché.
      const ocr = new OcrService(new DocumentService(files), files, { cacheDir, modelBaseUrl: 'http://127.0.0.1:9' })
      await expect(ocr.extract('eng', ['iVBORw0KGgo='])).rejects.toMatchObject({
        code: 'IO_ERROR',
        message: expect.stringContaining('conexión a internet')
      })
      // Antes: tesseract.js lanzaba dentro de su evento (error no capturado) y la
      // operación no terminaba nunca.
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  }, 60_000)
})
