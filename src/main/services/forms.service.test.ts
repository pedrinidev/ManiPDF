import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { FormsService, uniqueFieldName } from './forms.service'
import { DocumentService } from './document.service'
import { FileService } from './file.service'

describe('uniqueFieldName', () => {
  it('añade un sufijo a los nombres ocupados y quita los puntos', () => {
    const used = new Set(['nombre', 'nombre_2'])
    expect(uniqueFieldName('nombre', used)).toBe('nombre_3')
    expect(uniqueFieldName('  libre ', used)).toBe('libre')
    expect(uniqueFieldName('datos.dni', used)).toBe('datos_dni')
    expect(uniqueFieldName('   ', used)).toBe('campo')
  })
})

describe('crear campos', () => {
  it('un nombre que ya existe en el PDF se renombra (antes el campo se omitía en silencio)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manipdf-forms-'))
    try {
      const pdf = await PDFDocument.create()
      const page = pdf.addPage([400, 400])
      pdf.getForm().createTextField('nombre').addToPage(page, { x: 10, y: 10, width: 100, height: 20 })
      const file = join(dir, 'formulario.pdf')
      await writeFile(file, await pdf.save())

      const docs = new DocumentService(new FileService())
      const d = await docs.openPath(file)
      const rect = { x: 0.1, y: 0.1, w: 0.3, h: 0.05 }
      const updated = await new FormsService(docs).create(d.id, [
        { type: 'text', name: 'nombre', page: 1, rect, options: [] },
        { type: 'checkbox', name: 'datos.ok', page: 1, rect: { ...rect, y: 0.3 }, options: [] }
      ])
      const names = (await PDFDocument.load(updated.data)).getForm().getFields().map((f) => f.getName())
      expect(names.sort()).toEqual(['datos_ok', 'nombre', 'nombre_2'])

      await expect(
        new FormsService(docs).create(d.id, [{ type: 'text', name: 'x', page: 9, rect, options: [] }])
      ).rejects.toMatchObject({ code: 'INVALID_PDF' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
