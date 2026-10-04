/** Lista de documentos recientes, persistida en localStorage. */
const KEY = 'manipdf.recents'
const MAX = 8

export interface RecentDoc {
  path: string
  name: string
}

export function getRecents(): RecentDoc[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as RecentDoc[]) : []
  } catch {
    return []
  }
}

export function addRecent(path: string | null, name: string): void {
  if (!path) return
  const list = getRecents().filter((r) => r.path !== path)
  list.unshift({ path, name })
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch {
    /* sin almacenamiento disponible: la lista no se recuerda */
  }
}

export function clearRecents(): void {
  localStorage.removeItem(KEY)
}

/** Quita un archivo de la lista (p. ej. si ya no existe). */
export function removeRecent(path: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(getRecents().filter((r) => r.path !== path)))
  } catch {
    /* sin almacenamiento: no hay lista que limpiar */
  }
}

/**
 * Quita de la lista los archivos que ya no existen (movidos o borrados) y
 * devuelve la lista resultante. Antes seguían apareciendo y fallaban al abrirlos.
 */
export async function pruneMissingRecents(): Promise<RecentDoc[]> {
  const list = getRecents()
  if (list.length === 0) return list
  const existing = new Set(await window.api.app.existingPaths(list.map((r) => r.path)))
  const kept = list.filter((r) => existing.has(r.path))
  if (kept.length !== list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(kept))
    } catch {
      /* sin almacenamiento: se mostrará filtrada igualmente */
    }
  }
  return kept
}
