import { describe, it, expect } from 'vitest'
import { PdfDocument } from './document.model'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('PdfDocument', () => {
  it('un documento nuevo no está sucio y deriva el nombre de la ruta', () => {
    const doc = PdfDocument.fromBytes(bytes('pdf'), '/ruta/al/archivo.pdf')
    expect(doc.isDirty).toBe(false)
    expect(doc.fileName).toBe('archivo.pdf')
    expect(doc.encryptionPassword).toBeNull()
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

  it('markSaved limpia el estado y fija la ruta', () => {
    const doc = PdfDocument.fromBytes(bytes('x'), null)
    doc.replaceBytes(bytes('y'))
    doc.markSaved('/guardado/aqui.pdf')
    expect(doc.isDirty).toBe(false)
    expect(doc.filePath).toBe('/guardado/aqui.pdf')
    expect(doc.fileName).toBe('aqui.pdf')
  })

  it('setDecryptedBytes guarda la contraseña SIN marcar como modificado', () => {
    const doc = PdfDocument.fromBytes(bytes('cifrado'), '/x.pdf')
    doc.setDecryptedBytes(bytes('descifrado'), 'secreta')
    expect(new TextDecoder().decode(doc.bytes)).toBe('descifrado')
    expect(doc.encryptionPassword).toBe('secreta')
    expect(doc.isDirty).toBe(false)
  })
})
