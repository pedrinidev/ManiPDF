import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Carpetas temporales de la app. Algunas contienen el documento DESCIFRADO
 * (imprimir, desbloquear con Ghostscript); se borran al terminar, pero si la app
 * se cierra de golpe quedaban en disco. Todas llevan el prefijo «manipdf-» y, al
 * arrancar, se eliminan las que dejó una ejecución anterior.
 */

/** mkdtemp añade 6 caracteres aleatorios. Incluye los prefijos de versiones anteriores. */
const OWN_TEMP_DIR = /^(manipdf-[a-z]+|pdfprint|pdfgray|pdfsep)-[A-Za-z0-9]{6}$/

export function makeTempDir(kind: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `manipdf-${kind}-`))
}

/**
 * Borra las carpetas temporales propias con más de `olderThanMs` de antigüedad.
 * Solo se llama desde la instancia principal (bloqueo de instancia única), así que
 * no hay otra ejecución usándolas. Devuelve cuántas borró.
 */
export async function removeStaleTempDirs(
  options: { base?: string; olderThanMs?: number } = {}
): Promise<number> {
  const base = options.base ?? tmpdir()
  const olderThanMs = options.olderThanMs ?? 60_000
  let removed = 0
  let names: string[]
  try {
    names = await readdir(base)
  } catch {
    return 0
  }
  for (const name of names) {
    if (!OWN_TEMP_DIR.test(name)) continue
    const path = join(base, name)
    try {
      const info = await stat(path)
      if (!info.isDirectory() || Date.now() - info.mtimeMs < olderThanMs) continue
      await rm(path, { recursive: true, force: true })
      removed++
    } catch {
      /* en uso o sin permiso: se intentará en el próximo arranque */
    }
  }
  return removed
}
