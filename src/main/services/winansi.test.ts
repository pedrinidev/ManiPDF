import { describe, it, expect, beforeAll } from 'vitest'
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib'
import { toEncodable } from './winansi'

let font: PDFFont

beforeAll(async () => {
  font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
})

describe('toEncodable (fuentes estándar de PDF)', () => {
  it('deja intacto el español y lo que la fuente ya admite', () => {
    const text = 'Revisión: año, señor, ¿ok? ¡Sí! 10 € — «comillas» “tipográficas”'
    expect(toEncodable(text, font)).toBe(text)
  })

  it('sustituye símbolos y letras frecuentes por equivalentes legibles', () => {
    expect(toEncodable('Total → 10 €', font)).toBe('Total -> 10 €')
    expect(toEncodable('Łódź', font)).toBe('Lódz')
    expect(toEncodable('x ≥ 3', font)).toBe('x >= 3')
  })

  it('descompone ligaduras (frecuentes en el OCR)', () => {
    expect(toEncodable('ﬁnal ﬂujo', font)).toBe('final flujo')
  })

  it('lo irrepresentable se marca con el comodín (o se omite)', () => {
    expect(toEncodable('Revisar 😀', font)).toBe('Revisar ?')
    expect(toEncodable('αβγ', font, '')).toBe('')
  })

  it('el resultado siempre se puede medir y dibujar con la fuente', () => {
    const text = toEncodable('Expediente Nº 5 — Łódź → ✓ 😀 ﬁ', font)
    expect(() => font.widthOfTextAtSize(text, 12)).not.toThrow()
  })

  it('conserva los saltos de línea', () => {
    expect(toEncodable('uno\ndos', font)).toBe('uno\ndos')
  })
})
