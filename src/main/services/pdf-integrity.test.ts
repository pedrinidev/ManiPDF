/**
 * Tests de regresión de integridad (auditoría 2026-10): ejecutan los SERVICIOS
 * reales con Electron simulado sobre PDFs generados en memoria. No dependen de
 * Ghostscript (los cifrados son AES, que se descifran sin pérdidas).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, readdir, rm, stat, chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PDFDict,
  PDFDocument,
  PDFHeader,
  PDFNumber,
  PDFHexString,
  PDFName,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  degrees
} from 'pdf-lib'
import { PDFDocument as CryptoDocument } from '@cantoo/pdf-lib'

vi.mock('electron', () => ({ dialog: {}, BrowserWindow: class {}, shell: {}, app: {} }))

import { DocumentService } from './document.service'
import { PagesService } from './pages.service'
import { RedactService } from './redact.service'
import { OptimizeService } from './optimize.service'
import { CombineService } from './combine.service'
import { SecurityService } from './security.service'
import { FileService } from './file.service'
import { AnnotationsService } from './annotations.service'
import { StampService } from './stamp.service'
import { FormsService } from './forms.service'

let dir = ''

/** FileService con los diálogos sustituidos por respuestas fijas. */
class TestFiles extends FileService {
  nextSave: string | null = null
  nextOpenMany: string[] = []
  async pickSavePath(): Promise<string | null> {
    return this.nextSave
  }
  async pickOpenPaths(): Promise<string[]> {
    return this.nextOpenMany
  }
}

function services(): { files: TestFiles; docs: DocumentService } {
  const files = new TestFiles()
  return { files, docs: new DocumentService(files) }
}

/** 3 páginas · campo «nombre» en la 1 · enlace 1→2 · marcadores a 2 y 3 · «SECRETO-123» en la 2. */
async function richPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const [p1, p2, p3] = [pdf.addPage([612, 792]), pdf.addPage([612, 792]), pdf.addPage([612, 792])]
  p1.drawText('Indice', { x: 50, y: 700, size: 16, font })
  p2.drawText('SECRETO-123', { x: 50, y: 700, size: 16, font })
  p3.drawText('Pagina 3', { x: 50, y: 700, size: 16, font })
  const field = pdf.getForm().createTextField('nombre')
  field.setText('Juan')
  field.addToPage(p1, { x: 50, y: 600, width: 200, height: 24 })
  const ctx = pdf.context
  p1.node.addAnnot(ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 690, 300, 720], Dest: [p2.ref, 'Fit'] })))
  const outlines = ctx.nextRef()
  const o1 = ctx.nextRef()
  const o2 = ctx.nextRef()
  ctx.assign(o1, ctx.obj({ Title: PDFHexString.fromText('Cap 2'), Parent: outlines, Next: o2, Dest: [p2.ref, 'Fit'] }))
  ctx.assign(o2, ctx.obj({ Title: PDFHexString.fromText('Cap 3'), Parent: outlines, Prev: o1, Dest: [p3.ref, 'Fit'] }))
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: o1, Last: o2, Count: 2 }))
  pdf.catalog.set(PDFName.of('Outlines'), outlines)
  return pdf.save()
}

async function encrypted(
  bytes: Uint8Array,
  options: { userPassword: string; ownerPassword: string; modifying: boolean; assembly?: boolean }
): Promise<Uint8Array> {
  const doc = await CryptoDocument.load(bytes)
  doc.encrypt({
    userPassword: options.userPassword,
    ownerPassword: options.ownerPassword,
    permissions: {
      printing: 'highResolution',
      modifying: options.modifying,
      copying: false,
      documentAssembly: options.assembly ?? false
    }
  })
  return doc.save()
}

async function save(name: string, bytes: Uint8Array): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

async function inspect(bytes: Uint8Array): Promise<{ pages: number; fields: number; outlines: boolean; encrypted: boolean }> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const encrypted = !!pdf.context.trailerInfo.Encrypt
  const outlines = !!pdf.catalog.get(PDFName.of('Outlines'))
  return { pages: pdf.getPageCount(), fields: encrypted ? -1 : pdf.getForm().getFields().length, outlines, encrypted }
}

/** ¿Aparece el texto en algún flujo del archivo (aunque sea un objeto huérfano)? */
async function containsText(bytes: Uint8Array, text: string): Promise<boolean> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const hex = Buffer.from(text, 'latin1').toString('hex').toUpperCase()
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    let data: Uint8Array
    try {
      data = decodePDFRawStream(object).decode()
    } catch {
      continue
    }
    const s = Buffer.from(data).toString('latin1')
    if (s.includes(text) || s.toUpperCase().includes(hex)) return true
  }
  return false
}

/** Texto visible de cada página (cadenas hex de los operadores Tj de pdf-lib). */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents()
    const streams = contents && 'asArray' in contents ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents]
    let text = ''
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue
      const data = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
      for (const m of data.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += Buffer.from(m[1], 'hex').toString('latin1')
    }
    return text
  })
}

/** Valor /P (permisos) del diccionario /Encrypt de un archivo cifrado. */
async function permissionsOf(bytes: Uint8Array): Promise<number> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const encrypt = pdf.context.lookup(pdf.context.trailerInfo.Encrypt, PDFDict)
  return encrypt.lookup(PDFName.of('P'), PDFNumber).asNumber()
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manipdf-test-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('páginas: se conserva el catálogo (C3)', () => {
  it('borrar una página conserva formulario y marcadores', async () => {
    const { files, docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    const out = await new PagesService(docs, files).remove(d.id, [2])
    expect(await inspect(out.data)).toMatchObject({ pages: 2, fields: 1, outlines: true })
  })

  it('reordenar conserva formulario y marcadores y aplica el orden', async () => {
    const { files, docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    const out = await new PagesService(docs, files).reorder(d.id, [2, 0, 1])
    expect(await inspect(out.data)).toMatchObject({ pages: 3, fields: 1, outlines: true })
    expect(await pageTexts(out.data)).toEqual(['Pagina 3', 'Indice', 'SECRETO-123'])
  })

  it('duplicar: la copia comparte recursos y su widget pertenece al mismo campo', async () => {
    const { files, docs } = services()
    const original = await richPdf()
    const d = await docs.openPath(await save('rich.pdf', original))
    const out = await new PagesService(docs, files).duplicate(d.id, [0])
    expect(await pageTexts(out.data)).toEqual(['Indice', 'Indice', 'SECRETO-123', 'Pagina 3'])
    const pdf = await PDFDocument.load(out.data)
    const fields = pdf.getForm().getFields()
    expect(fields.map((f) => f.getName())).toEqual(['nombre'])
    expect(fields[0].acroField.getWidgets()).toHaveLength(2)
    // Comparte contenido: el archivo no duplica el tamaño.
    expect(out.data.length).toBeLessThan(original.length * 1.5)
  })

  it('extraer conserva el formulario de las páginas extraídas', async () => {
    const { files, docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    files.nextSave = join(dir, 'extraido.pdf')
    await new PagesService(docs, files).extract(d.id, [0], null)
    const extracted = new Uint8Array(await readFile(files.nextSave))
    expect(await inspect(extracted)).toMatchObject({ pages: 1, fields: 1 })
    expect(await containsText(extracted, 'SECRETO-123')).toBe(false)
  })
})

describe('sin restos de páginas borradas o censuradas (C2)', () => {
  it('censurar una página enlazada no deja su texto dentro del archivo', async () => {
    const { docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    expect(await containsText(d.data, 'SECRETO-123')).toBe(true)
    // JPEG mínimo válido (1×1): la imagen de la página censurada.
    const tinyJpeg =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
    const out = await new RedactService(docs).apply(
      d.id,
      [{ pageIndex: 1, jpegBase64: tinyJpeg, widthPt: 612, heightPt: 792 }],
      d.revision
    )
    expect(await containsText(out.data, 'SECRETO-123')).toBe(false)
  })

  it('borrar la página enlazada elimina su contenido del archivo', async () => {
    const { files, docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    const out = await new PagesService(docs, files).remove(d.id, [1])
    expect(await containsText(out.data, 'SECRETO-123')).toBe(false)
  })
})

describe('PDFs cifrados (C1 / A4)', () => {
  it('restringido sin permiso de modificar: solo lectura, sin corromper; se desbloquea con la de propietario', async () => {
    const { files, docs } = services()
    const bytes = await encrypted(await richPdf(), { userPassword: '', ownerPassword: 'dueno-123', modifying: false })
    const d = await docs.openPath(await save('restringido.pdf', bytes))
    expect(d.readOnly).toBe('restricted')
    await expect(new PagesService(docs, files).rotate(d.id, [0], 90)).rejects.toMatchObject({ code: 'READ_ONLY' })
    await expect(docs.unlock(d.id, 'otra')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' })

    const unlocked = await docs.unlock(d.id, 'dueno-123')
    expect(unlocked.readOnly).toBeNull()
    const rotated = await new PagesService(docs, files).rotate(d.id, [0], 90)
    expect(await inspect(rotated.data)).toMatchObject({ pages: 3, fields: 1, outlines: true })

    // Al guardar sigue protegido igual: mismos permisos, se abre sin contraseña.
    files.nextSave = join(dir, 'restringido-guardado.pdf')
    await docs.saveAs(d.id, null)
    const saved = new Uint8Array(await readFile(files.nextSave))
    expect(await permissionsOf(saved)).toBe(await permissionsOf(bytes))
    const reopened = await CryptoDocument.load(saved, { password: '' })
    expect(reopened.getPageCount()).toBe(3)
  })

  it('sin contraseña de apertura y CON permiso de modificar: se edita directamente', async () => {
    const { files, docs } = services()
    const bytes = await encrypted(await richPdf(), { userPassword: '', ownerPassword: 'dueno-123', modifying: true })
    const d = await docs.openPath(await save('modificable.pdf', bytes))
    expect(d.readOnly).toBeNull()
    const out = await new PagesService(docs, files).remove(d.id, [2])
    expect(await pageTexts(out.data)).toEqual(['Indice', 'SECRETO-123'])
  })

  it('con contraseña de apertura: bloqueado hasta introducirla; al guardar conserva contraseña y permisos', async () => {
    const { files, docs } = services()
    const bytes = await encrypted(await richPdf(), { userPassword: 'abrir-123', ownerPassword: 'dueno-456', modifying: false })
    const d = await docs.openPath(await save('con-clave.pdf', bytes))
    expect(d.readOnly).toBe('needs-password')
    await expect(new PagesService(docs, files).rotate(d.id, [0], 90)).rejects.toMatchObject({ code: 'READ_ONLY' })

    const unlocked = await docs.unlock(d.id, 'abrir-123')
    expect(await inspect(unlocked.data)).toMatchObject({ fields: 1, outlines: true }) // descifrado sin pérdidas

    files.nextSave = join(dir, 'con-clave-guardado.pdf')
    await docs.saveAs(d.id, null)
    const saved = new Uint8Array(await readFile(files.nextSave))
    expect(await permissionsOf(saved)).toBe(await permissionsOf(bytes))
    await expect(CryptoDocument.load(saved, { password: '' })).rejects.toThrow()
    expect((await CryptoDocument.load(saved, { password: 'abrir-123' })).getPageCount()).toBe(3)

    files.nextSave = join(dir, 'con-clave-copia.pdf')
    await docs.exportCopy(d.id, null)
    expect((await inspect(new Uint8Array(await readFile(files.nextSave)))).encrypted).toBe(true)
  })

  it('combinar con un PDF restringido que no permite ensamblar: error claro, no páginas en blanco', async () => {
    const { files, docs } = services()
    const plain = await save('plano.pdf', await richPdf())
    const locked = await save(
      'sin-ensamblar.pdf',
      await encrypted(await richPdf(), { userPassword: '', ownerPassword: 'x', modifying: false })
    )
    files.nextOpenMany = [plain, locked]
    files.nextSave = join(dir, 'combinado.pdf')
    await expect(new CombineService(docs, files).merge(null)).rejects.toMatchObject({ code: 'READ_ONLY' })
  })

  it('combinar con un PDF cifrado que sí permite ensamblar: se descifra y sus páginas tienen contenido', async () => {
    const { files, docs } = services()
    const plain = await save('plano.pdf', await richPdf())
    const allowed = await save(
      'ensamblable.pdf',
      await encrypted(await richPdf(), { userPassword: '', ownerPassword: 'x', modifying: false, assembly: true })
    )
    files.nextOpenMany = [plain, allowed]
    files.nextSave = join(dir, 'combinado.pdf')
    const result = await new CombineService(docs, files).merge(null)
    expect(result.pageCount).toBe(6)
    const texts = await pageTexts(new Uint8Array(await readFile(files.nextSave)))
    expect(texts.slice(3)).toEqual(['Indice', 'SECRETO-123', 'Pagina 3'])
  })
})

describe('proteger usa AES (C4)', () => {
  it('un PDF con cabecera 1.3 se cifra con AES-128 (antes RC4 de 40 bits)', async () => {
    const { files, docs } = services()
    const pdf = await PDFDocument.load(await richPdf())
    pdf.context.header = PDFHeader.forVersion(1, 3)
    const d = await docs.openPath(await save('v13.pdf', await pdf.save()))
    files.nextSave = join(dir, 'v13-protegido.pdf')
    await new SecurityService(docs, files).protect(
      d.id,
      { userPassword: 'secreto1', permissions: { printing: true, copying: false, modifying: false } },
      null
    )
    const raw = Buffer.from(await readFile(files.nextSave)).toString('latin1')
    expect(raw).toMatch(/\/V 4/)
    expect(raw).toMatch(/\/CFM \/AESV2/)
  })
})

describe('guardado seguro (M3)', () => {
  it('restore con bytes inválidos no toca el documento', async () => {
    const { docs } = services()
    const original = await richPdf()
    const d = await docs.openPath(await save('rich.pdf', original))
    await expect(docs.restore(d.id, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'INVALID_PDF' })
    expect(docs.getDocument(d.id).bytes.length).toBe(original.length)
  })

  it('la escritura es atómica: sustituye el archivo, conserva permisos y no deja temporales', async () => {
    const files = new FileService()
    const path = join(dir, 'atomico.pdf')
    await writeFile(path, 'viejo')
    await chmod(path, 0o600)
    await files.write(path, new TextEncoder().encode('nuevo'))
    expect(await readFile(path, 'utf8')).toBe('nuevo')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await readdir(dir)).filter((n) => n.includes('atomico.pdf.') && n.endsWith('.tmp'))).toEqual([])
  })
})

describe('comprimir sin pérdida (C3)', () => {
  it('conserva formulario y marcadores', async () => {
    const { docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    const out = await new OptimizeService(docs).lossless(d.id)
    expect(await inspect(out.data)).toMatchObject({ pages: 3, fields: 1, outlines: true })
  })
})

describe('textos con caracteres especiales y páginas giradas (A1 / A2)', () => {
  async function rotatedPdf(): Promise<string> {
    const pdf = await PDFDocument.create()
    pdf.addPage([612, 792]).setRotation(degrees(90))
    pdf.getForm().createTextField('nombre').addToPage(pdf.getPage(0), { x: 50, y: 600, width: 200, height: 24 })
    return save('girada.pdf', await pdf.save())
  }

  it('grabar una nota y un texto con «→», emoji y «Ł» en una página girada no falla', async () => {
    const { files, docs } = services()
    const d = await docs.openPath(await rotatedPdf())
    const service = new AnnotationsService(docs, files)
    const out = await service.burn(d.id, [
      { id: 't', page: 1, color: '#000000', type: 'text', pos: { x: 0.1, y: 0.2 }, text: 'Total → 10 € Łódź', size: 0.02 },
      { id: 'n', page: 1, color: '#ffe082', type: 'note', pos: { x: 0.5, y: 0.5 }, text: 'Revisar 😀' }
    ])
    expect(out.isDirty).toBe(true)
  })

  it('marcas con «→» y «Ł» no fallan', async () => {
    const { docs } = services()
    const d = await docs.openPath(await rotatedPdf())
    await expect(
      new StampService(docs).apply(d.id, {
        watermarkText: 'BORRADOR ✓',
        watermarkOpacity: 0.2,
        watermarkColor: '#ff0000',
        watermarkDiagonal: true,
        header: { left: 'Expediente → Łódź', center: '', right: '' },
        footer: { left: '', center: '{page}/{total}', right: '' },
        hfFontSize: 10,
        hfColor: '#000000',
        margin: 28
      })
    ).resolves.toBeTruthy()
  })

  it('rellenar un campo con «Łukasz» guarda el valor real (sin aplanar)', async () => {
    const { docs } = services()
    const d = await docs.openPath(await rotatedPdf())
    const out = await new FormsService(docs).fill(d.id, [{ name: 'nombre', value: 'Łukasz Nowak' }], false)
    const pdf = await PDFDocument.load(out.data)
    expect(pdf.getForm().getTextField('nombre').getText()).toBe('Łukasz Nowak')
  })

  it('aplanar con caracteres no representables da un error claro', async () => {
    const { docs } = services()
    const d = await docs.openPath(await rotatedPdf())
    await expect(
      new FormsService(docs).fill(d.id, [{ name: 'nombre', value: 'Łukasz' }], true)
    ).rejects.toThrow(/No se puede aplanar/)
  })
})

describe('operaciones preparadas sobre una versión anterior (M1)', () => {
  it('censurar tras reordenar las páginas se rechaza (CONFLICT) en vez de tapar otra página', async () => {
    const { files, docs } = services()
    const d = await docs.openPath(await save('rich.pdf', await richPdf()))
    const baseRevision = d.revision // el renderer rasteriza sobre esta versión…
    await new PagesService(docs, files).reorder(d.id, [2, 0, 1]) // …y mientras tanto se reordena
    const tinyJpeg =
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
    await expect(
      new RedactService(docs).apply(d.id, [{ pageIndex: 1, jpegBase64: tinyJpeg, widthPt: 612, heightPt: 792 }], baseRevision)
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
