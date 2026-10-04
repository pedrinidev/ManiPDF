import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  PDFDocument as CryptoDocument,
  PDFHeader,
  PDFRef as CryptoRef
} from '@cantoo/pdf-lib'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream
} from 'pdf-lib'
import { resolveGhostscript, ghostscriptEnv, gsOutputPath } from './ghostscript'
import { makeTempDir } from './temp'
import type { Protection } from '../domain/document.model'

const execFileAsync = promisify(execFile)

/**
 * Cifrado y descifrado de PDFs.
 *
 * - Descifrar: primero SIN PÉRDIDAS con @cantoo/pdf-lib (descifra cada objeto y
 *   conserva formularios, marcadores, fuentes…). Ghostscript queda como respaldo:
 *   re-destila el documento (puede aplanar formularios y recomprimir).
 * - Cifrar: siempre AES-128. @cantoo/pdf-lib elige el algoritmo según la versión
 *   de la cabecera y, con PDF 1.3 o 2.0, usaba RC4 de 40 bits (rompible).
 */

/** Bits de permisos del valor /P (PDF 32000-1, tabla 22). */
const PERM = {
  print: 1 << 2,
  modify: 1 << 3,
  copy: 1 << 4,
  annotate: 1 << 5,
  fillForms: 1 << 8,
  accessibility: 1 << 9,
  assemble: 1 << 10,
  printHighRes: 1 << 11
} as const

/** /P con todos los permisos concedidos. */
export const ALL_PERMISSIONS = -4

export interface EncryptionInfo {
  encrypted: boolean
  /** Valor /P del diccionario /Encrypt (null si no está cifrado). */
  permissions: number | null
}

export type DecryptResult =
  | { ok: true; bytes: Uint8Array; method: 'lossless' | 'ghostscript' }
  | { ok: 'unsupported' } // no se pudo descifrar (ni sin pérdidas ni con Ghostscript)
  | { ok: 'wrong-password' } // la contraseña no abre el documento

/** Lee si el PDF está cifrado y con qué permisos. */
export async function readEncryption(bytes: Uint8Array): Promise<EncryptionInfo> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const encrypt = pdf.context.lookup(pdf.context.trailerInfo.Encrypt)
  if (!(encrypt instanceof PDFDict)) return { encrypted: false, permissions: null }
  const p = encrypt.lookup(PDFName.of('P'))
  return { encrypted: true, permissions: p instanceof PDFNumber ? p.asNumber() : ALL_PERMISSIONS }
}

/** ¿Los permisos permiten modificar el contenido? */
export function canModify(permissions: number | null): boolean {
  return permissions === null || (permissions & PERM.modify) !== 0
}

/** ¿Los permisos permiten copiar sus páginas a otro documento (ensamblar)? */
export function canAssemble(permissions: number | null): boolean {
  return permissions === null || (permissions & (PERM.assemble | PERM.modify)) !== 0
}

/**
 * Descifra un PDF con la contraseña dada ('' = sin contraseña de apertura).
 * `allowGhostscript: false` exige el método sin pérdidas: es el único que
 * distingue contraseñas (Ghostscript abre un PDF sin contraseña de apertura con
 * cualquier contraseña, así que no sirve para verificar la de propietario).
 */
export async function decryptPdf(
  bytes: Uint8Array,
  password: string,
  { allowGhostscript = true }: { allowGhostscript?: boolean } = {}
): Promise<DecryptResult> {
  const lossless = await decryptLossless(bytes, password)
  if (lossless === 'wrong-password') return { ok: 'wrong-password' }
  if (lossless) return { ok: true, bytes: lossless, method: 'lossless' }
  if (!allowGhostscript) return { ok: 'unsupported' }
  return decryptWithGhostscript(bytes, password)
}

/**
 * Cifra un PDF (AES-128) con la protección indicada. Sin contraseña de
 * propietario conocida se genera una aleatoria: quien abra con la de apertura NO
 * es propietario y los lectores respetan los permisos.
 */
export async function encryptPdf(bytes: Uint8Array, protection: Protection): Promise<Uint8Array> {
  const pdf = await CryptoDocument.load(bytes, { updateMetadata: false })
  applyEncryption(pdf, {
    userPassword: protection.userPassword,
    ownerPassword: protection.ownerPassword,
    permissions: protection.permissions
  })
  return pdf.save()
}

/** Aplica cifrado AES-128 a un documento de @cantoo/pdf-lib (antes de `save()`). */
export function applyEncryption(
  pdf: CryptoDocument,
  options: { userPassword: string; ownerPassword: string | null; permissions: number }
): void {
  // La librería decide el algoritmo por la versión de la cabecera: 1.7 → AES-128.
  pdf.context.header = PDFHeader.forVersion(1, 7)
  pdf.encrypt({
    userPassword: options.userPassword,
    ownerPassword: options.ownerPassword || randomBytes(24).toString('base64'),
    permissions: permissionsFromFlags(options.permissions)
  })
}

/** Valor /P a partir de los permisos del diálogo «Proteger». */
export function permissionsToFlags(p: { printing: boolean; copying: boolean; modifying: boolean }): number {
  let flags = ALL_PERMISSIONS
  if (!p.printing) flags &= ~(PERM.print | PERM.printHighRes)
  if (!p.copying) flags &= ~(PERM.copy | PERM.accessibility)
  if (!p.modifying) flags &= ~(PERM.modify | PERM.annotate | PERM.fillForms | PERM.assemble)
  return flags
}

/** Permisos de @cantoo/pdf-lib equivalentes a un valor /P. */
export function permissionsFromFlags(p: number): {
  printing: false | 'lowResolution' | 'highResolution'
  modifying: boolean
  copying: boolean
  annotating: boolean
  fillingForms: boolean
  contentAccessibility: boolean
  documentAssembly: boolean
} {
  return {
    printing: (p & PERM.print) === 0 ? false : (p & PERM.printHighRes) !== 0 ? 'highResolution' : 'lowResolution',
    modifying: (p & PERM.modify) !== 0,
    copying: (p & PERM.copy) !== 0,
    annotating: (p & PERM.annotate) !== 0,
    fillingForms: (p & PERM.fillForms) !== 0,
    contentAccessibility: (p & PERM.accessibility) !== 0,
    documentAssembly: (p & PERM.assemble) !== 0
  }
}

// -- descifrado sin pérdidas ----------------------------------------------------

/**
 * Descifra con @cantoo/pdf-lib y guarda SIN cifrar. Devuelve null si el método no
 * es fiable para este archivo (el resultado no parece descifrado): entonces se
 * prueba con Ghostscript.
 */
async function decryptLossless(
  bytes: Uint8Array,
  password: string
): Promise<Uint8Array | 'wrong-password' | null> {
  let pdf: CryptoDocument
  try {
    pdf = await CryptoDocument.load(bytes, { password, updateMetadata: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    return /NEEDS PASSWORD|Password incorrect/i.test(message) ? 'wrong-password' : null
  }
  try {
    const encryptRef = pdf.context.trailerInfo.Encrypt
    pdf.context.trailerInfo.Encrypt = undefined
    if (encryptRef instanceof CryptoRef) pdf.context.delete(encryptRef)
    const out = await pdf.save()
    return (await looksDecrypted(out)) ? out : null
  } catch {
    return null
  }
}

/**
 * Comprobación de que el resultado es legible: el primer flujo de contenido debe
 * descomprimirse y parecer texto (operadores PDF). Un descifrado fallido deja
 * datos aleatorios que ni siquiera se descomprimen.
 */
async function looksDecrypted(bytes: Uint8Array): Promise<boolean> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const page of pdf.getPages().slice(0, 3)) {
    const contents = page.node.Contents()
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r)) : [contents]
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue
      let data: Uint8Array
      try {
        data = decodePDFRawStream(stream).decode()
      } catch {
        return false
      }
      if (data.length > 0) return isMostlyText(data)
    }
  }
  return true // sin contenido que comprobar (páginas vacías)
}

function isMostlyText(data: Uint8Array): boolean {
  const sample = data.subarray(0, 4096)
  let text = 0
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) text++
  return text / sample.length > 0.75
}

// -- respaldo: Ghostscript ------------------------------------------------------

/**
 * Un argumento entre comillas para un archivo «@args» de Ghostscript (admite
 * espacios, también al principio, y comillas). Ghostscript solo entiende «\"»
 * como escape: las demás barras invertidas se leen tal cual. Una barra justo antes
 * de la comilla final o un salto de línea no se pueden escribir: entonces, null.
 */
function ghostscriptQuoted(arg: string): string | null {
  if (/\\$|[\r\n]/.test(arg)) return null
  return `"${arg.replace(/"/g, '\\"')}"`
}

/** Exportada solo para las pruebas: el camino normal es `decryptPdf`. */
export async function decryptWithGhostscript(bytes: Uint8Array, password: string): Promise<DecryptResult> {
  const gs = resolveGhostscript()
  if (!gs) return { ok: 'unsupported' }

  const dir = await makeTempDir('dec')
  const input = join(dir, 'in.pdf')
  const output = join(dir, 'out.pdf')
  // La contraseña va en un archivo de argumentos privado (carpeta temporal 0700,
  // archivo 0600) y no en la línea de comandos, que cualquier proceso del equipo
  // puede leer (`ps`) mientras Ghostscript trabaja. Solo si no se puede escribir
  // ahí (acaba en «\») va como argumento, como antes.
  const passwordArg = `-sPDFPassword=${password}`
  const quoted = ghostscriptQuoted(passwordArg)
  const argsFile = join(dir, 'args.txt')
  try {
    await writeFile(input, bytes)
    if (quoted) await writeFile(argsFile, `${quoted}\n`, { mode: 0o600 })

    // Capturamos la salida de Ghostscript: con contraseña INCORRECTA suele avisar
    // ("This file requires a password..." / "Password did not work") y, aun así,
    // a veces genera un PDF en blanco. Por eso no basta con que exista el archivo.
    let logs = ''
    try {
      const { stdout, stderr } = await execFileAsync(gs, [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        quoted ? `@${argsFile}` : passwordArg,
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.7',
        `-sOutputFile=${gsOutputPath(output)}`,
        input
      ], { env: ghostscriptEnv() })
      logs = `${stdout}\n${stderr}`
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string }
      logs = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${String(err)}`
    }

    // Señal fiable de fallo: Ghostscript menciona la contraseña en sus mensajes.
    if (/password/i.test(logs)) return { ok: 'wrong-password' }
    if (!existsSync(output)) return { ok: 'unsupported' }
    const out = await readFile(output)
    if (out.length === 0) return { ok: 'unsupported' }
    return { ok: true, bytes: new Uint8Array(out), method: 'ghostscript' }
  } catch {
    return { ok: 'unsupported' }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
