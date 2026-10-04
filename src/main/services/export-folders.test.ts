import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { FileService, safeFileName } from './file.service'
import { ConvertService } from './convert.service'
import { CombineService } from './combine.service'
import { DocumentService } from './document.service'

let parent = ''

class TestFiles extends FileService {
  async pickDirectory(): Promise<string | null> {
    return parent
  }
}

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'manipdf-export-'))
})
afterEach(async () => {
  await rm(parent, { recursive: true, force: true })
})

describe('carpetas de exportación (M4)', () => {
  it('createUniqueFolder nunca reutiliza una carpeta existente', async () => {
    const files = new FileService()
    expect(await files.createUniqueFolder(parent, 'informe-imagenes')).toBe(join(parent, 'informe-imagenes'))
    expect(await files.createUniqueFolder(parent, 'informe-imagenes')).toBe(join(parent, 'informe-imagenes-2'))
  })

  it('safeFileName quita caracteres inválidos y rutas', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(safeFileName('../../.zshrc')).not.toContain('/')
    expect(safeFileName('   ')).toBe('documento')
  })
})

describe('exportar a imágenes página a página (M5)', () => {
  it('escribe cada página en una subcarpeta nueva y no pisa exportaciones anteriores', async () => {
    const convert = new ConvertService(new TestFiles())
    for (const expected of ['informe-imagenes', 'informe-imagenes-2']) {
      const job = await convert.beginExport('informe', 'png', 3, null)
      expect(job.dir).toBe(join(parent, expected))
      for (let n = 1; n <= 3; n++) await convert.writeImage(job.exportId, n, new Uint8Array([n]))
      expect(convert.endExport(job.exportId)).toEqual({ dir: job.dir, count: 3 })
      expect((await readdir(job.dir)).sort()).toEqual(['pagina-1.png', 'pagina-2.png', 'pagina-3.png'])
    }
  })

  it('rechaza imágenes vacías y páginas fuera de rango', async () => {
    const convert = new ConvertService(new TestFiles())
    const job = await convert.beginExport('doc', 'jpg', 2, null)
    await expect(convert.writeImage(job.exportId, 1, new Uint8Array())).rejects.toThrow(/vacía/)
    await expect(convert.writeImage(job.exportId, 3, new Uint8Array([1]))).rejects.toThrow(/fuera de rango/)
    convert.endExport(job.exportId)
    await expect(convert.writeImage(job.exportId, 1, new Uint8Array([1]))).rejects.toThrow(/ya no está en curso/)
  })
})

describe('dividir (M4)', () => {
  it('guarda las partes en una subcarpeta nueva', async () => {
    const pdf = await PDFDocument.create()
    for (let i = 0; i < 3; i++) pdf.addPage([200, 200])
    const source = join(parent, 'libro.pdf')
    await writeFile(source, await pdf.save())
    const files = new TestFiles()
    const docs = new DocumentService(files)
    const d = await docs.openPath(source)
    const result = await new CombineService(docs, files).split(d.id, 1, null)
    expect(result.dir).toBe(join(parent, 'libro-partes'))
    expect((await readdir(result.dir)).sort()).toEqual(['libro-parte-1.pdf', 'libro-parte-2.pdf', 'libro-parte-3.pdf'])
  })
})
