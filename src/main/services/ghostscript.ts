import { execFileSync } from 'node:child_process'

/**
 * Resolución y detección de Ghostscript (binario externo, no empaquetado).
 *
 * Electron (app de GUI) no hereda el PATH del shell, así que probamos rutas
 * típicas además de "gs". La detección es REAL: ejecuta `gs --version`, porque
 * asumir que "gs" está en el PATH daba falsos positivos (y luego fallaba con un
 * "ENOENT" feo en vez de avisar de forma clara).
 */
const GS_CANDIDATES = [
  '/opt/homebrew/bin/gs',
  '/usr/local/bin/gs',
  '/opt/local/bin/gs',
  '/usr/bin/gs',
  'C:\\Program Files\\gs\\bin\\gswin64c.exe',
  'gswin64c',
  'gswin32c',
  'gs'
]

let cached: string | null | undefined

/** Ruta a un Ghostscript realmente ejecutable, o null si no está instalado. */
export function resolveGhostscript(): string | null {
  if (cached !== undefined) return cached
  for (const candidate of GS_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      cached = candidate
      return cached
    } catch {
      /* no es este: probar el siguiente */
    }
  }
  cached = null
  return cached
}

/** Mensaje amable (según el sistema) cuando falta Ghostscript. */
export function ghostscriptMissingMessage(): string {
  const base = 'Esta función necesita Ghostscript, que no está instalado en tu equipo.'
  if (process.platform === 'darwin') {
    return `${base} Instálalo con Homebrew: «brew install ghostscript» (o desde ghostscript.com) y reinicia ManiPDF.`
  }
  if (process.platform === 'win32') {
    return `${base} Descárgalo desde ghostscript.com/releases/gsdnld.html, instálalo y reinicia ManiPDF.`
  }
  return `${base} Instálalo con tu gestor de paquetes (p. ej. «sudo apt install ghostscript») y reinicia ManiPDF.`
}
