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
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
}

export function clearRecents(): void {
  localStorage.removeItem(KEY)
}
