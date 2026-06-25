/**
 * Empaqueta Ghostscript (binario + librerías + recursos) en
 * resources/gs/<plataforma>-<arch>/ para que ManiPDF lo lleve "de fábrica" y las
 * funciones de imprenta (separación, grises) funcionen SIN que el usuario instale
 * nada. Cada SO genera su propio paquete en su runner de CI (o en local).
 *
 * Estructura de salida (igual en los 3 SO, para simplificar el arranque):
 *   resources/gs/<plat>-<arch>/bin/    -> ejecutable (gs / gswin64c.exe + dll)
 *   resources/gs/<plat>-<arch>/libs/   -> librerías dinámicas (mac/linux)
 *   resources/gs/<plat>-<arch>/share/  -> Resource/Init, lib, iccprofiles, fonts
 *
 * Requiere tener Ghostscript instalado en la máquina de build (y dylibbundler en
 * macOS). NO redistribuimos GS desde aquí: lo toma del sistema de build.
 *
 * Cumplimiento AGPL: Ghostscript es AGPL; al empaquetarlo se incluye su licencia
 * y el enlace a su código (ver resources/gs/LICENSE-ghostscript.txt y "Acerca de").
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const platform = process.platform
const arch = process.arch
const ROOT = process.cwd()
const OUT = join(ROOT, 'resources', 'gs', `${platform}-${arch}`)

function log(msg) {
  console.log(`[bundle-gs] ${msg}`)
}

/** Localiza el ejecutable de Ghostscript del sistema (resolviendo symlinks). */
function findGs() {
  if (platform === 'win32') {
    // Choco instala en C:\Program Files\gs\gs<ver>\bin\gswin64c.exe y no siempre
    // lo deja en el PATH del paso siguiente: lo buscamos directamente.
    for (const base of ['C:\\Program Files\\gs', 'C:\\Program Files (x86)\\gs']) {
      if (!existsSync(base)) continue
      for (const ver of readdirSync(base)) {
        const exe = join(base, ver, 'bin', 'gswin64c.exe')
        if (existsSync(exe)) {
          log(`Ghostscript encontrado: ${exe}`)
          return exe
        }
      }
    }
    // Respaldo: PATH
    try {
      const p = which('gswin64c')
      if (p) {
        log(`Ghostscript encontrado (PATH): ${p}`)
        return p
      }
    } catch {
      /* nada */
    }
    throw new Error('No se encontró Ghostscript (gswin64c.exe) en la máquina de build.')
  }

  for (const n of ['/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/usr/bin/gs', 'gs']) {
    try {
      const out = execFileSync(n, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
      const real = String(
        execFileSync('readlink', ['-f', n.startsWith('/') ? n : which(n)], {
          stdio: ['ignore', 'pipe', 'ignore']
        })
      ).trim()
      log(`Ghostscript ${String(out).trim()} encontrado: ${real}`)
      return real
    } catch {
      /* siguiente */
    }
  }
  throw new Error('No se encontró Ghostscript en la máquina de build. Instálalo antes de empaquetar.')
}

function which(cmd) {
  const finder = platform === 'win32' ? 'where' : 'which'
  return String(execFileSync(finder, [cmd], { stdio: ['ignore', 'pipe', 'ignore'] }))
    .split(/\r?\n/)[0]
    .trim()
}

/** Carpeta share/ghostscript a partir del binario (…/bin/gs -> …/share/ghostscript). */
function shareDirFrom(gsBin) {
  // …/<prefix>/bin/gs  ->  …/<prefix>/share/ghostscript
  const prefix = dirname(dirname(gsBin))
  const candidates = [
    join(prefix, 'share', 'ghostscript'),
    join(prefix, 'share', 'ghostscript', gsVersion(gsBin))
  ]
  for (const c of candidates) if (existsSync(join(c, 'Resource', 'Init', 'gs_init.ps'))) return c
  // Búsqueda amplia bajo el prefijo
  const found = findFile(join(prefix, 'share'), 'gs_init.ps')
  if (found) return dirname(dirname(dirname(found))) // …/share/ghostscript/<x>/Resource/Init -> …/share/ghostscript/<x>
  throw new Error('No se encontró el directorio de recursos de Ghostscript (gs_init.ps).')
}

function gsVersion(gsBin) {
  return String(execFileSync(gsBin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })).trim()
}

function findFile(dir, name) {
  if (!existsSync(dir)) return null
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) {
      const r = findFile(p, name)
      if (r) return r
    } else if (e === name) {
      return p
    }
  }
  return null
}

function reset() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(join(OUT, 'bin'), { recursive: true })
  mkdirSync(join(OUT, 'share'), { recursive: true })
}

function bundleMac() {
  const gsBin = findGs()
  reset()
  mkdirSync(join(OUT, 'libs'), { recursive: true })
  cpSync(gsBin, join(OUT, 'bin', 'gs'))
  execFileSync('chmod', ['+w', join(OUT, 'bin', 'gs')])
  // dylibbundler: copia y reescribe las librerías a @executable_path/../libs
  execFileSync(
    'dylibbundler',
    ['-of', '-b', '-x', join(OUT, 'bin', 'gs'), '-d', join(OUT, 'libs'), '-p', '@executable_path/../libs/'],
    { stdio: 'inherit' }
  )
  cpSync(shareDirFrom(gsBin), join(OUT, 'share'), { recursive: true })
  log(`macOS listo en ${OUT}`)
}

function bundleLinux() {
  const gsBin = findGs()
  reset()
  mkdirSync(join(OUT, 'libs'), { recursive: true })
  cpSync(gsBin, join(OUT, 'bin', 'gs'))
  // Copiar librerías NO del sistema que reporta ldd
  const ldd = String(execFileSync('ldd', [gsBin], { stdio: ['ignore', 'pipe', 'ignore'] }))
  for (const line of ldd.split('\n')) {
    const m = line.match(/=>\s+(\/\S+)/)
    if (!m) continue
    const lib = m[1]
    if (lib.startsWith('/lib') || lib.startsWith('/usr/lib/x86_64-linux-gnu/libc')) continue // sistema base
    try {
      cpSync(lib, join(OUT, 'libs', lib.split('/').pop()))
    } catch {
      /* omitir */
    }
  }
  cpSync(shareDirFrom(gsBin), join(OUT, 'share'), { recursive: true })
  log(`Linux listo en ${OUT}`)
}

function bundleWin() {
  const gsBin = findGs() // …\bin\gswin64c.exe
  reset()
  const binDir = dirname(gsBin)
  const gsHome = dirname(binDir)
  // Ejecutable + DLL
  cpSync(gsBin, join(OUT, 'bin', 'gswin64c.exe'))
  for (const dll of ['gsdll64.dll', 'gsdll64.lib']) {
    if (existsSync(join(binDir, dll))) cpSync(join(binDir, dll), join(OUT, 'bin', dll))
  }
  // Recursos: lib, Resource, iccprofiles, fonts
  for (const d of ['lib', 'Resource', 'iccprofiles', 'fonts']) {
    if (existsSync(join(gsHome, d))) cpSync(join(gsHome, d), join(OUT, 'share', d), { recursive: true })
  }
  log(`Windows listo en ${OUT}`)
}

// Nota de licencia AGPL junto al binario empaquetado.
function writeLicenseNote() {
  const dir = join(ROOT, 'resources', 'gs')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'LICENSE-ghostscript.txt'),
    [
      'Este producto incluye Ghostscript, distribuido bajo licencia GNU AGPL v3.',
      'Ghostscript es propiedad de Artifex Software, Inc.',
      '',
      'Código fuente y licencia: https://www.ghostscript.com/',
      'Texto de la AGPL v3: https://www.gnu.org/licenses/agpl-3.0.html',
      '',
      'ManiPDF invoca Ghostscript como programa separado; el resto de ManiPDF no se',
      'distribuye bajo AGPL.'
    ].join('\n')
  )
}

/** Tamaño total (MB) de una carpeta, recursivo. */
function dirSizeMB(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    total += s.isDirectory() ? dirSizeMB(p) * 1048576 : s.size
  }
  return total / 1048576
}

/** Verifica que el paquete tiene lo esencial; avisa fuerte si algo falta. */
function verify() {
  const libs = existsSync(join(OUT, 'libs')) ? readdirSync(join(OUT, 'libs')).length : 0
  const initOk = existsSync(join(OUT, 'share', 'Resource', 'Init', 'gs_init.ps'))
  const size = dirSizeMB(OUT).toFixed(1)
  log(`Verificación → tamaño: ${size} MB · librerías: ${libs} · gs_init.ps: ${initOk ? 'sí' : 'NO'}`)
  if (!initOk) log('AVISO: faltan recursos de GS (gs_init.ps) → el GS empaquetado podría no funcionar.')
  if (platform !== 'win32' && libs === 0) log('AVISO: no se copió ninguna librería → el GS empaquetado podría no arrancar.')
}

try {
  if (platform === 'darwin') bundleMac()
  else if (platform === 'linux') bundleLinux()
  else if (platform === 'win32') bundleWin()
  else throw new Error(`Plataforma no soportada: ${platform}`)
  writeLicenseNote()
  verify()
  log('Hecho.')
} catch (err) {
  console.error(`[bundle-gs] ERROR: ${err.message}`)
  process.exit(1)
}
