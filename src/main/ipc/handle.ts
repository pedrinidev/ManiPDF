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

/** Cola de operaciones en curso por documento (ver handleExclusive). */
const queues = new Map<string, Promise<unknown>>()

/**
 * Como `handle`, pero en exclusiva por documento: las operaciones sobre el mismo
 * documento se ejecutan de una en una, en orden de llegada. Si no, dos a la vez
 * (p. ej. crear el PDF buscable y girar una página) leían los mismos bytes y la
 * que terminaba después borraba el resultado de la otra.
 */
export function handleExclusive<T>(id: string, fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  const previous = queues.get(id) ?? Promise.resolve()
  // `handle` nunca rechaza (convierte los errores en IpcResult): la cola no se rompe.
  const result = previous.then(() => handle(fn))
  queues.set(id, result)
  void result.then(() => {
    if (queues.get(id) === result) queues.delete(id)
  })
  return result
}

/** Envuelve un handler en el formato IpcResult, capturando errores de forma uniforme. */
export async function handle<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: toIpcError(err) }
  }
}
