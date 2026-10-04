import { Buffer } from 'node:buffer'

/**
 * Decodifica base64 a bytes en un ArrayBuffer PROPIO (byteOffset 0).
 *
 * pdf-lib lee los JPEG con `new DataView(datos.buffer)` e ignora el desplazamiento
 * de la vista. Node agrupa los Buffer pequeños (< 4 KB) en un bloque compartido,
 * donde no empiezan en 0, y pdf-lib leía otros bytes: una firma JPEG pequeña
 * fallaba con «SOI not found in JPEG».
 */
export function bytesFromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'))
}
