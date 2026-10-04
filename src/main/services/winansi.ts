import type { PDFFont } from 'pdf-lib'

/**
 * Las fuentes estándar de PDF (Helvetica…) solo escriben el juego WinAnsi: el
 * español completo, pero no símbolos como «→», emojis, ligaduras «ﬁ» (frecuentes
 * en el OCR) ni letras como «Ł». Antes, un solo carácter así hacía fallar la
 * operación entera (grabar anotaciones, marcas, la capa de texto del OCR…).
 */

/** Sustituciones legibles para símbolos y letras frecuentes que no tiene WinAnsi. */
const REPLACEMENTS: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '↔': '<->',
  '⇒': '=>',
  '⇐': '<=',
  '↑': '^',
  '↓': 'v',
  '≤': '<=',
  '≥': '>=',
  '≠': '!=',
  '≈': '~',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '―': '—',
  '✓': 'v',
  '✔': 'v',
  '✗': 'x',
  '✘': 'x',
  '★': '*',
  '☆': '*',
  '●': '•',
  'Ł': 'L',
  'ł': 'l',
  'Đ': 'D',
  'đ': 'd',
  'Ħ': 'H',
  'ħ': 'h',
  'ı': 'i',
  'ŋ': 'n',
  'ſ': 's',
  '\t': ' '
}

/**
 * Adapta un texto a lo que puede escribir `font`: deja lo que ya admite, sustituye
 * lo conocido (incluidas ligaduras y letras con diacríticos que no estén, vía NFKD)
 * y cambia el resto por `placeholder` («?» por defecto: se ve que faltaba algo).
 * Los saltos de línea se conservan.
 */
export function toEncodable(text: string, font: PDFFont, placeholder = '?'): string {
  const supported = characterSet(font)
  const fits = (s: string): boolean => [...s].every((c) => supported.has(c.codePointAt(0) ?? -1))
  let out = ''
  for (const ch of text) {
    if (ch === '\n' || fits(ch)) {
      out += ch
      continue
    }
    const candidate = REPLACEMENTS[ch] ?? ch.normalize('NFKD').replace(/\p{M}/gu, '')
    out += candidate && fits(candidate) ? candidate : placeholder
  }
  return out
}

const sets = new WeakMap<PDFFont, Set<number>>()

function characterSet(font: PDFFont): Set<number> {
  let set = sets.get(font)
  if (!set) {
    set = new Set(font.getCharacterSet())
    sets.set(font, set)
  }
  return set
}
