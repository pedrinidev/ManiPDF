/**
 * Descarga a ~/Downloads los instaladores de una Release de GitHub (los que
 * compila CI en cada SO NATIVO). Úsalo en vez de generar Windows/Linux en un Mac:
 * un cross-build local empaqueta el Ghostscript del equipo que compila (el de Mac),
 * que no sirve en Windows/Linux. Los de la Release sí traen el GS correcto por SO.
 *
 * Uso:
 *   node scripts/get-installers.mjs            # última versión publicada
 *   node scripts/get-installers.mjs v0.1.6     # una versión concreta
 */
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const tag =
  process.argv[2] ||
  JSON.parse(execFileSync('gh', ['release', 'view', '--json', 'tagName'], { encoding: 'utf8' })).tagName

const dest = join(homedir(), 'Downloads')
console.log(`[get-installers] Descargando instaladores de ${tag} (compilados por CI) a ${dest} ...`)

execFileSync(
  'gh',
  [
    'release',
    'download',
    tag,
    '--pattern',
    '*.dmg',
    '--pattern',
    '*.AppImage',
    '--pattern',
    '*.exe',
    '--dir',
    dest,
    '--clobber'
  ],
  { stdio: 'inherit' }
)

console.log('[get-installers] Hecho. Cada instalador trae el Ghostscript de su plataforma.')
