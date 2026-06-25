import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument } from '@cantoo/pdf-lib'
import { resolveGhostscript } from './ghostscript'

const execFileAsync = promisify(execFile)

export type DecryptResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: 'unsupported' } // no hay Ghostscript para descifrar
  | { ok: 'wrong-password' } // la contraseña no abre el documento

/**
 * Descifra un PDF protegido usando Ghostscript con la contraseña dada y devuelve
 * los bytes ya sin cifrar (para poder editarlos). pdf-lib no sabe descifrar con
 * contraseña, por eso se delega en Ghostscript (que el usuario ya tiene).
 */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<DecryptResult> {
  const gs = resolveGhostscript()
  if (!gs) return { ok: 'unsupported' }

  const dir = await mkdtemp(join(tmpdir(), 'manipdf-dec-'))
  const input = join(dir, 'in.pdf')
  const output = join(dir, 'out.pdf')
  try {
    await writeFile(input, bytes)

    // Capturamos la salida de Ghostscript: con contraseña INCORRECTA suele avisar
    // ("This file requires a password..." / "Password did not work") y, aun así,
    // a veces genera un PDF en blanco. Por eso no basta con que exista el archivo.
    let logs = ''
    try {
      const { stdout, stderr } = await execFileAsync(gs, [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        `-sPDFPassword=${password}`,
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.7',
        `-sOutputFile=${output}`,
        input
      ])
      logs = `${stdout}\n${stderr}`
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string }
      logs = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${String(err)}`
    }

    // Señal fiable de fallo: Ghostscript menciona la contraseña en sus mensajes.
    if (/password/i.test(logs)) return { ok: 'wrong-password' }
    if (!existsSync(output)) return { ok: 'wrong-password' }
    const out = await readFile(output)
    if (out.length === 0) return { ok: 'wrong-password' }
    return { ok: true, bytes: new Uint8Array(out) }
  } catch {
    return { ok: 'wrong-password' }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Re-cifra un PDF con una contraseña (apertura). Se usa al guardar un documento
 * que se abrió protegido, para que el archivo en disco siga protegido.
 */
export async function encryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  pdf.encrypt({
    userPassword: password,
    ownerPassword: password,
    permissions: {
      printing: 'highResolution',
      modifying: true,
      copying: true,
      annotating: true,
      fillingForms: true,
      contentAccessibility: true,
      documentAssembly: true
    }
  })
  return pdf.save()
}
