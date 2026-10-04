import { describe, it, expect } from 'vitest'
import { PdfDocument } from './document.model'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('PdfDocument', () => {
  it('un documento nuevo no está sucio y deriva el nombre de la ruta', () => {
    const doc = PdfDocument.fromBytes(bytes('pdf'), '/ruta/al/archivo.pdf')
    expect(doc.isDirty).toBe(false)
    expect(doc.fileName).toBe('archivo.pdf')
    expect(doc.protection).toBeNull()
    expect(doc.readOnly).toBe(false)
  })

  it('sin ruta usa un nombre por defecto', () => {
    const doc = PdfDocument.fromBytes(bytes('pdf'), null)
    expect(doc.fileName).toBe('Sin título.pdf')
  })

  it('cada documento tiene un id único', () => {
    const a = PdfDocument.fromBytes(bytes('a'), null)
    const b = PdfDocument.fromBytes(bytes('b'), null)
    expect(a.id).not.toBe(b.id)
  })

  it('replaceBytes cambia los bytes y marca como modificado', () => {
    const doc = PdfDocument.fromBytes(bytes('viejo'), '/x.pdf')
    doc.replaceBytes(bytes('nuevo'))
    expect(new TextDecoder().decode(doc.bytes)).toBe('nuevo')
    expect(doc.isDirty).toBe(true)
  })

  it('deshacer hasta lo guardado deja el documento sin cambios', () => {
    const doc = PdfDocument.fromBytes(bytes('original'), '/x.pdf')
    doc.replaceBytes(bytes('editado'))
    doc.restoreBytes(bytes('otro'))
    expect(doc.isDirty).toBe(true)
    doc.restoreBytes(bytes('original')) // deshacer hasta el estado abierto
    expect(doc.isDirty).toBe(false)
    doc.replaceBytes(bytes('editado'))
    doc.markSaved('/x.pdf')
    doc.restoreBytes(bytes('original')) // ya no es lo guardado
    expect(doc.isDirty).toBe(true)
    doc.restoreBytes(bytes('editado')) // rehacer hasta lo guardado
    expect(doc.isDirty).toBe(false)
  })

  it('markSaved limpia el estado y fija la ruta', () => {
    const doc = PdfDocument.fromBytes(bytes('x'), null)
    doc.replaceBytes(bytes('y'))
    doc.markSaved('/guardado/aqui.pdf')
    expect(doc.isDirty).toBe(false)
    expect(doc.filePath).toBe('/guardado/aqui.pdf')
    expect(doc.fileName).toBe('aqui.pdf')
  })

  it('markLocked lo deja en solo lectura', () => {
    const doc = PdfDocument.fromBytes(bytes('cifrado'), '/x.pdf')
    doc.markLocked({ reason: 'restricted', permissions: -1852 })
    expect(doc.readOnly).toBe(true)
    expect(doc.lock?.reason).toBe('restricted')
  })

  it('setDecryptedBytes guarda la protección, desbloquea y NO marca como modificado', () => {
    const doc = PdfDocument.fromBytes(bytes('cifrado'), '/x.pdf')
    doc.markLocked({ reason: 'needs-password', permissions: -4 })
    const protection = { userPassword: 'secreta', ownerPassword: null, permissions: -4 }
    doc.setDecryptedBytes(bytes('descifrado'), protection)
    expect(new TextDecoder().decode(doc.bytes)).toBe('descifrado')
    expect(doc.protection).toEqual(protection)
    expect(doc.readOnly).toBe(false)
    expect(doc.isDirty).toBe(false)
  })
})
