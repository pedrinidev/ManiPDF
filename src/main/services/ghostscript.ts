import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Resolución de Ghostscript. Prioriza la copia EMPAQUETADA con la app
 * (resources/gs/<plataforma>-<arch>/), generada por scripts/bundle-gs.mjs, para
 * que las funciones de imprenta funcionen sin que el usuario instale nada. Si no
 * está empaquetada (build sin GS, o arquitectura no cubierta), cae al GS del
 * sistema; y si tampoco hay, las funciones avisan amablemente.
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

interface Resolved {
  bin: string
  /** Carpeta raíz del GS empaquetado (con share/ y libs/), o null si es del sistema. */
  root: string | null
}

let cached: Resolved | null | undefined

/** Carpeta del GS empaquetado utilizable para esta plataforma, o null. */
function bundledRoot(): string | null {
  const exact = `${process.platform}-${process.arch}`
  const bases = [process.resourcesPath, join(process.cwd(), 'resources')].filter(Boolean) as string[]
  for (const base of bases) {
    const gsDir = join(base, 'gs')
    if (!existsSync(gsDir)) continue
    // 1) Coincidencia exacta plataforma-arquitectura.
    const exactRoot = join(gsDir, exact)
    if (existsSync(join(exactRoot, 'bin', binaryName()))) return exactRoot
    // 2) Windows: el binario x64 también corre en Windows ARM (emulación). Aceptamos
    //    cualquier carpeta win32-* con binario válido (cubre win-arm64 sin GS arm).
    if (process.platform === 'win32') {
      for (const d of readdirSync(gsDir)) {
        if (!d.startsWith('win32-')) continue
        const root = join(gsDir, d)
        if (existsSync(join(root, 'bin', binaryName()))) return root
      }
    }
  }
  return null
}

function binaryName(): string {
  return process.platform === 'win32' ? 'gswin64c.exe' : 'gs'
}

function resolve(): Resolved | null {
  if (cached !== undefined) return cached
  // 1) GS empaquetado (preferido)
  const root = bundledRoot()
  if (root) {
    cached = { bin: join(root, 'bin', binaryName()), root }
    return cached
  }
  // 2) GS del sistema (detección real)
  for (const candidate of GS_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      cached = { bin: candidate, root: null }
      return cached
    } catch {
      /* siguiente */
    }
  }
  cached = null
  return cached
}

/** Ruta a un Ghostscript usable (empaquetado o del sistema), o null si no hay. */
export function resolveGhostscript(): string | null {
  return resolve()?.bin ?? null
}

/**
 * Entorno con el que invocar Ghostscript. Para el GS empaquetado fija GS_LIB
 * (recursos de inicialización + perfiles de color) y, en Linux, LD_LIBRARY_PATH
 * a sus librerías. Para el GS del sistema usa el entorno normal.
 */
export function ghostscriptEnv(): NodeJS.ProcessEnv {
  const r = resolve()
  if (!r || !r.root) return process.env
  const share = join(r.root, 'share')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GS_LIB: [join(share, 'Resource', 'Init'), join(share, 'lib'), join(share, 'iccprofiles')].join(delimiter)
  }
  if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = [join(r.root, 'libs'), process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(delimiter)
  }
  return env
}

/** Mensaje amable (según el sistema) cuando no hay Ghostscript ni empaquetado ni en el sistema. */
export function ghostscriptMissingMessage(): string {
  const base = 'Esta función necesita Ghostscript, que no se pudo encontrar.'
  if (process.platform === 'darwin') {
    return `${base} Instálalo con Homebrew: «brew install ghostscript» (o desde ghostscript.com) y reinicia ManiPDF.`
  }
  if (process.platform === 'win32') {
    return `${base} Descárgalo desde ghostscript.com/releases/gsdnld.html, instálalo y reinicia ManiPDF.`
  }
  return `${base} Instálalo con tu gestor de paquetes (p. ej. «sudo apt install ghostscript») y reinicia ManiPDF.`
}
