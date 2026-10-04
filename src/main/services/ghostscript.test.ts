import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PDFDocument as CryptoDocument, StandardFonts as CryptoFonts } from '@cantoo/pdf-lib'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { gsOutputPath, resolveGhostscript } from './ghostscript'
import { DocumentService } from './document.service'
import { SeparationsService } from './separations.service'
import { FileService } from './file.service'
import { decryptWithGhostscript } from './pdf-crypto'

describe('gsOutputPath', () => {
  it('escapa «%» (Ghostscript lo interpreta como nº de página)', () => {
    expect(gsOutputPath('/x/Oferta 50%descuento.pdf')).toBe('/x/Oferta 50%%descuento.pdf')
    expect(gsOutputPath('/x/normal.pdf')).toBe('/x/normal.pdf')
  })
})

// Necesita Ghostscript instalado (o empaquetado); si no lo hay, se omite.
describe.skipIf(!resolveGhostscript())('exportar en grises', () => {
  it('respeta el nombre elegido aunque lleve «%»', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manipdf-gs-'))
    try {
      const pdf = await PDFDocument.create()
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      pdf.addPage([300, 300]).drawText('Hola', { x: 50, y: 150, size: 24, font })
      const source = join(dir, 'origen.pdf')
      await writeFile(source, await pdf.save())

      const target = join(dir, 'Oferta 50%descuento.pdf')
      const files = new (class extends FileService {
        async pickSavePath(): Promise<string | null> {
          return target
        }
      })()
      const docs = new DocumentService(files)
      const d = await docs.openPath(source)
      const result = await new SeparationsService(docs, files).exportGray(d.id, null)
      expect(result.filePath).toBe(target)
      expect(existsSync(target)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!resolveGhostscript())('descifrar con Ghostscript (M9)', () => {
  // La contraseña va en un archivo de argumentos (no en la línea de comandos, visible
  // con `ps`): debe llegar intacta aunque lleve espacios, comillas o barras.
  it.each(['abc def', '  empieza con espacios', 'comi"llas', 'barra\\invertida', 'a\\"b', 'termina\\', "apos'trofo", '#y@'])(
    'contraseña %j',
    async (password) => {
      const pdf = await CryptoDocument.create()
      pdf.addPage([300, 200]).drawText('Hola', { x: 20, y: 100, size: 14, font: await pdf.embedFont(CryptoFonts.Helvetica) })
      pdf.encrypt({ userPassword: password, ownerPassword: `${password}-propietario` })
      const encrypted = await pdf.save()

      const result = await decryptWithGhostscript(encrypted, password)
      expect(result.ok).toBe(true)
      if (result.ok === true) expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1)
      expect(await decryptWithGhostscript(encrypted, `${password}?`)).toEqual({ ok: 'wrong-password' })
    }
  )
})
