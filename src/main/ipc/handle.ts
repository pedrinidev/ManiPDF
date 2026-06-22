import { DocumentError } from '../services/document.service'
import type { IpcResult, IpcError } from '@shared/ipc-contract'

/** Convierte cualquier excepción en un IpcError serializable (nunca lanzamos por el puente). */
export function toIpcError(err: unknown): IpcError {
  if (err instanceof DocumentError) {
    return { code: err.code, message: err.message }
  }
  return {
    code: 'UNKNOWN',
    message: err instanceof Error ? err.message : 'Error desconocido'
  }
}

/** Envuelve un handler en el formato IpcResult, capturando errores de forma uniforme. */
export async function handle<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: toIpcError(err) }
  }
}
