// utif (decodificador TIFF puro-JS) no trae tipos; lo envolvemos con una API tipada.
// @ts-expect-error -- el paquete 'utif' resuelve a un .js sin declaraciones
import UTIF from 'utif'

export interface TiffIFD {
  width: number
  height: number
  [key: string]: unknown
}

interface UtifApi {
  decode(buffer: ArrayBuffer | Uint8Array): TiffIFD[]
  decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: TiffIFD): void
  toRGBA8(ifd: TiffIFD): Uint8Array
}

export const utif = UTIF as UtifApi
