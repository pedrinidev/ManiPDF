import { utif } from './utif'

/**
 * Plancha decodificada: cobertura de tinta por píxel en un byte (0 = sin tinta,
 * 255 = tinta plena; en RGB, intensidad del canal). Un byte por píxel y canal: con
 * Float32 una página carta a 300 ppp ocupaba ~128 MB en planchas; así, ~32 MB.
 */
export interface DecodedPlate {
  name: string
  coverage: Uint8Array
  width: number
  height: number
}

/** Byte de cobertura (0..255) → fracción (0..1), precalculado. */
const UNIT = Float32Array.from({ length: 256 }, (_, v) => v / 255)

const CMYK_NAMES = ['Cyan', 'Magenta', 'Yellow', 'Black'] as const
const RGB_NAMES = ['Red', 'Green', 'Blue'] as const

/** Color de muestra (para la casilla) y absorción RGB de cada tinta. */
export function inkInfo(name: string): { swatch: string; abs: [number, number, number] } {
  switch (name) {
    case 'Cyan':
      return { swatch: '#00a8e0', abs: [1, 0, 0] }
    case 'Magenta':
      return { swatch: '#ec008c', abs: [0, 1, 0] }
    case 'Yellow':
      return { swatch: '#fff200', abs: [0, 0, 1] }
    case 'Black':
      return { swatch: '#000000', abs: [1, 1, 1] }
    case 'Red':
      return { swatch: '#ff0000', abs: [0, 1, 1] }
    case 'Green':
      return { swatch: '#00c000', abs: [1, 0, 1] }
    case 'Blue':
      return { swatch: '#0000ff', abs: [1, 1, 0] }
    default:
      // Tinta plana: color real desconocido → aproximación neutra.
      return { swatch: '#9a6cff', abs: [0.6, 0.6, 0.6] }
  }
}

/**
 * Decodifica un TIFF CMYK (tiff32nc) en planchas de cobertura por canal C/M/Y/K.
 * Solo devuelve los canales con tinta real, así un PDF a 1 tinta negra muestra
 * únicamente la plancha "Black" (sin C/M/Y fantasma).
 */
export function decodeCmykPlates(cmykTiffBase64: string): DecodedPlate[] {
  const bytes = base64ToBytes(cmykTiffBase64)
  const ifds = utif.decode(bytes)
  utif.decodeImage(bytes, ifds[0])
  const ifd = ifds[0]
  const w = ifd.width
  const h = ifd.height
  // En tiff32nc los datos son CMYK intercalados (4 bytes/píxel): 0=sin tinta, 255=plena.
  const data = ifd.data as Uint8Array
  const n = w * h

  const plates: DecodedPlate[] = []
  for (let ch = 0; ch < 4; ch++) {
    const coverage = new Uint8Array(n)
    let max = 0
    for (let i = 0; i < n; i++) {
      const v = data[i * 4 + ch]
      coverage[i] = v
      if (v > max) max = v
    }
    // Descarta canales prácticamente vacíos (umbral ~1/255).
    if (max > 1) plates.push({ name: CMYK_NAMES[ch], coverage, width: w, height: h })
  }
  return plates
}

/**
 * Decodifica un TIFF RGB (tiff24nc) en planchas de canal R/G/B. Aquí la cobertura
 * es la INTENSIDAD de luz del canal (1 = máximo). Se separa en el espacio original
 * del documento (RGB) para no distorsionar el color forzándolo a CMYK.
 */
export function decodeRgbPlates(rgbTiffBase64: string): DecodedPlate[] {
  const bytes = base64ToBytes(rgbTiffBase64)
  const ifds = utif.decode(bytes)
  utif.decodeImage(bytes, ifds[0])
  const ifd = ifds[0]
  const w = ifd.width
  const h = ifd.height
  const rgba = utif.toRGBA8(ifd) // tiff24nc → canales RGB directos
  const n = w * h

  const plates: DecodedPlate[] = []
  for (let ch = 0; ch < 3; ch++) {
    const coverage = new Uint8Array(n)
    for (let i = 0; i < n; i++) coverage[i] = rgba[i * 4 + ch]
    plates.push({ name: RGB_NAMES[ch], coverage, width: w, height: h })
  }
  return plates
}

/** Compone los canales RGB activos sobre fondo negro (aditivo, como una pantalla). */
export function compositeRgbImageData(plates: DecodedPlate[], enabled: Set<string>): ImageData {
  const { width: w, height: h } = plates[0]
  const chan = (name: string): Uint8Array | null =>
    enabled.has(name) ? (plates.find((p) => p.name === name)?.coverage ?? null) : null
  const r = chan('Red')
  const g = chan('Green')
  const b = chan('Blue')
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    out[o] = r ? r[i] : 0
    out[o + 1] = g ? g[i] : 0
    out[o + 2] = b ? b[i] : 0
    out[o + 3] = 255
  }
  return new ImageData(out, w, h)
}

/** Vista en gris de canales RGB: intensidad media de los canales activos (blanco = máximo). */
export function compositeRgbGrayImageData(plates: DecodedPlate[], enabled: Set<string>): ImageData {
  const { width: w, height: h } = plates[0]
  const active = plates.filter((p) => enabled.has(p.name)).map((p) => p.coverage)
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    let sum = 0
    for (const c of active) sum += c[i]
    const v = active.length ? sum / active.length : 0
    const o = i * 4
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }
  return new ImageData(out, w, h)
}

/** Compone las tintas activas simulando impresión sobre papel blanco (sustractivo). */
export function compositeImageData(plates: DecodedPlate[], enabled: Set<string>): ImageData {
  const { width: w, height: h } = plates[0]
  const active = plates
    .filter((p) => enabled.has(p.name))
    .map((p) => ({ cov: p.coverage, abs: inkInfo(p.name).abs }))
  const out = new Uint8ClampedArray(w * h * 4)

  for (let i = 0; i < w * h; i++) {
    let r = 1
    let g = 1
    let b = 1
    for (const ink of active) {
      const byte = ink.cov[i]
      if (byte === 0) continue
      const c = UNIT[byte]
      r *= 1 - c * ink.abs[0]
      g *= 1 - c * ink.abs[1]
      b *= 1 - c * ink.abs[2]
    }
    const o = i * 4
    out[o] = r * 255
    out[o + 1] = g * 255
    out[o + 2] = b * 255
    out[o + 3] = 255
  }
  return new ImageData(out, w, h)
}

/**
 * Compone las tintas activas en GRIS (vista de planchas/film): la cobertura de
 * tinta se suma y se pinta como negro sobre blanco. Con una sola tinta activa se
 * ve esa plancha aislada; es la vista clásica de prepress.
 */
export function compositeGrayImageData(plates: DecodedPlate[], enabled: Set<string>): ImageData {
  const { width: w, height: h } = plates[0]
  const active = plates.filter((p) => enabled.has(p.name)).map((p) => p.coverage)
  const out = new Uint8ClampedArray(w * h * 4)

  for (let i = 0; i < w * h; i++) {
    let cov = 0
    for (const c of active) cov += c[i]
    if (cov > 255) cov = 255
    const v = 255 - cov // 0 tinta = blanco, tinta plena = negro
    const o = i * 4
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }
  return new ImageData(out, w, h)
}

/**
 * Imagen en gris de una sola plancha (para exportar). En CMYK (`light=false`):
 * negro = tinta plena. En RGB (`light=true`): blanco = intensidad plena del canal.
 */
export function plateGrayImageData(plate: DecodedPlate, light = false): ImageData {
  const { width: w, height: h, coverage } = plate
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const v = light ? coverage[i] : 255 - coverage[i]
    const o = i * 4
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }
  return new ImageData(out, w, h)
}

/** Pinta un ImageData en un canvas nuevo y lo devuelve como PNG base64 (sin prefijo). */
export function imageDataToPngBase64(img: ImageData): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')?.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Limita las planchas en memoria: se conservan siempre las de las páginas montadas
 * en el visor y la recién separada; del resto, las más cercanas a ella hasta `max`
 * (las demás se regeneran si se vuelve a ellas).
 */
export function limitPlateCache<T>(
  cache: Map<number, T>,
  around: number,
  mounted: Map<number, number>,
  max: number
): Map<number, T> {
  if (cache.size <= max) return cache
  const others = [...cache.keys()]
    .filter((page) => !mounted.has(page) && page !== around)
    .sort((a, b) => Math.abs(a - around) - Math.abs(b - around))
  const room = Math.max(0, max - (cache.size - others.length))
  const drop = new Set(others.slice(room))
  return new Map([...cache].filter(([page]) => !drop.has(page)))
}
