import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createWorker, type Worker } from 'tesseract.js'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import { toEncodable } from './winansi'
import { drawInFrame, pageFrame, type PageFrame } from './page-frame'
import { bytesFromBase64 } from './base64'
import type { DocumentId, OcrInputPage, OcrLang, OpenDocumentDTO } from '@shared/ipc-contract'

/** Palabra reconocida con su caja en píxeles de la imagen. */
interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Dónde se guardan los modelos de idioma y de dónde se descargan. */
export interface OcrOptions {
  /** Carpeta de caché (en la carpeta de datos de la app). */
  cacheDir: string
  /** Base de descarga de los modelos; por defecto, el CDN de tesseract.js. */
  modelBaseUrl?: string
}

/** Idiomas admitidos (el código acaba en una URL y en un nombre de archivo). */
const OCR_LANGS: readonly string[] = ['spa', 'eng'] satisfies OcrLang[]

/** Modelos LSTM «best_int» de tesseract.js (los mismos que descarga por defecto). */
const MODEL_BASE_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data'
const MODEL_DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * Lógica del módulo "ocr". Usa tesseract.js EN NODE (proceso main): así el
 * modelo de idioma se descarga una vez y se cachea en disco, y se evita la
 * CSP del renderer. El renderer solo aporta las páginas ya rasterizadas.
 *
 * Nota: la primera ejecución descarga el modelo del idioma (requiere internet).
 * Antes se cacheaba en el directorio de trabajo: en la app instalada en macOS
 * es «/» (no escribible), así que nunca se guardaba y cada OCR pedía internet.
 */
export class OcrService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService,
    private readonly options: OcrOptions
  ) {}

  /** Extrae todo el texto de las imágenes (una por página). */
  async extract(lang: OcrLang, images: string[]): Promise<{ text: string }> {
    if (images.length === 0) throw new DocumentError('INVALID_PDF', 'No hay páginas para OCR')

    const worker = await this.makeWorker(lang)
    try {
      const parts: string[] = []
      for (let i = 0; i < images.length; i++) {
        const { data } = await worker.recognize(Buffer.from(images[i], 'base64'))
        parts.push(`--- Página ${i + 1} ---\n${data.text.trim()}`)
      }
      return { text: parts.join('\n\n') }
    } catch (err) {
      throw ocrError(err)
    } finally {
      await worker.terminate()
    }
  }

  /**
   * Hace buscable el documento: añade, SOBRE LAS PÁGINAS ORIGINALES, una capa de
   * texto invisible con lo reconocido en las imágenes recibidas (el renderer solo
   * envía las páginas sin texto). Antes se sustituía el documento entero por
   * imágenes JPEG de 144 ppp: se perdían vectores, enlaces, formularios y calidad,
   * también en las páginas que ya tenían texto.
   */
  async searchable(
    id: DocumentId,
    lang: OcrLang,
    pages: OcrInputPage[],
    baseRevision: number
  ): Promise<OpenDocumentDTO> {
    if (pages.length === 0) throw new DocumentError('INVALID_PDF', 'No hay páginas que reconocer')
    const doc = this.documents.getEditableDocument(id, baseRevision)
    let pdf: PDFDocument
    try {
      pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }
    const targets = pdf.getPages()
    validatePages(pages, targets.length)
    const font = await pdf.embedFont(StandardFonts.Helvetica)

    const worker = await this.makeWorker(lang)
    try {
      for (const page of pages) {
        const target = targets[page.pageNumber - 1]
        // `blocks: true` es imprescindible: en tesseract.js v6+ las cajas de
        // palabras NO se devuelven por defecto (data.blocks vendría vacío y no se
        // dibujaría la capa de texto invisible → el PDF no sería buscable).
        const { data } = await worker.recognize(bytesFromBase64(page.jpegBase64), {}, { blocks: true })
        const words = extractWords(data)
        // La imagen es la página tal como se ve: se dibuja en ese marco (también
        // en páginas giradas o recortadas).
        const frame = pageFrame(target)
        drawInFrame(target, frame, () => this.drawInvisibleText(target, words, page, frame, font))
      }

      doc.replaceBytes(await pdf.save())
      return this.documents.describe(id)
    } catch (err) {
      throw ocrError(err)
    } finally {
      await worker.terminate()
    }
  }

  /** Guarda un texto en un archivo .txt. */
  async saveText(text: string, window: BrowserWindow | null): Promise<{ filePath: string }> {
    const target = await this.files.pickSaveTextPath(window, 'texto-ocr.txt')
    if (!target) throw new DocumentError('CANCELLED', 'Guardado cancelado por el usuario')
    try {
      await this.files.write(target, new TextEncoder().encode(text))
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudo escribir el archivo de texto')
    }
    return { filePath: target }
  }

  // -- helpers --------------------------------------------------------------

  /**
   * Crea el worker de tesseract.js con el modelo ya en caché (así nunca toca la
   * red). tesseract.js tiene dos fallos que esto evita: si no puede cargar el
   * idioma, su promesa no se resuelve NUNCA (el OCR se quedaba en «Procesando…»)
   * y, sin manejador, además LANZA el error dentro de un evento (excepción no
   * capturada en el proceso principal).
   */
  private async makeWorker(lang: OcrLang): Promise<Worker> {
    if (!OCR_LANGS.includes(lang)) throw new DocumentError('IO_ERROR', `Idioma de OCR no admitido: ${String(lang)}`)
    await this.ensureModel(lang)
    return new Promise<Worker>((resolve, reject) => {
      let settled = false
      const fail = (err: unknown): void => {
        if (settled) return // fallos posteriores: los rechaza su propia tarea
        settled = true
        // Modelo dañado: se borra para descargarlo de nuevo la próxima vez.
        void rm(this.modelFile(lang), { force: true }).catch(() => {})
        reject(ocrError(err))
      }
      createWorker(lang, 1, { cachePath: this.options.cacheDir, errorHandler: fail }).then(
        (worker) => {
          if (settled) void worker.terminate()
          else {
            settled = true
            resolve(worker)
          }
        },
        fail
      )
    })
  }

  /** Descarga (una vez) el modelo del idioma a la caché, de forma atómica. */
  private async ensureModel(lang: OcrLang): Promise<void> {
    const file = this.modelFile(lang)
    if (existsSync(file)) return
    await mkdir(this.options.cacheDir, { recursive: true })
    const base = this.options.modelBaseUrl ?? MODEL_BASE_URL
    let data: Uint8Array
    try {
      const response = await fetch(`${base}/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, {
        signal: AbortSignal.timeout(MODEL_DOWNLOAD_TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`Network error: HTTP ${response.status}`)
      const raw = new Uint8Array(await response.arrayBuffer())
      data = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
    } catch (err) {
      throw ocrError(err instanceof Error && err.name === 'TimeoutError' ? new Error('network timeout') : err)
    }
    // Nunca queda un modelo a medias en la caché.
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, data)
    await rename(temp, file)
  }

  private modelFile(lang: OcrLang): string {
    return join(this.options.cacheDir, `${lang}.traineddata`)
  }

  /** Dibuja cada palabra con opacidad 0: invisible pero seleccionable/buscable. */
  private drawInvisibleText(
    page: PDFPage,
    words: OcrWord[],
    src: OcrInputPage,
    frame: PageFrame,
    font: PDFFont
  ): void {
    const sx = frame.width / src.imgWidthPx
    const sy = frame.height / src.imgHeightPx

    for (const w of words) {
      // Ligaduras («ﬁ» → «fi») y símbolos adaptados a la fuente estándar; lo que no
      // se pueda escribir se omite (es texto invisible). Antes, una sola palabra
      // así abortaba el PDF buscable entero.
      const text = toEncodable(w.text.trim(), font, '')
      if (!text) continue

      const boxW = (w.x1 - w.x0) * sx
      const boxH = (w.y1 - w.y0) * sy
      // Tamaño por altura de caja (la mayúscula ocupa ~0.7 del em → compensamos
      // para que el glifo case con la altura del texto escaneado).
      let size = Math.max(1, boxH / 0.72)
      // Si a ese tamaño el texto fuese MÁS ancho que su caja, lo reducimos para
      // que no se desborde ni se "corra" respecto a la imagen.
      const naturalW = font.widthOfTextAtSize(text, size)
      if (naturalW > boxW && naturalW > 0) size *= boxW / naturalW

      const x = w.x0 * sx
      // Baseline: el borde inferior de la caja menos el descendente (~0.21·em).
      const y = frame.height - w.y1 * sy + size * 0.21
      try {
        page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0), opacity: 0 })
      } catch {
        // Carácter no soportado por la fuente estándar: se omite esa palabra.
      }
    }
  }
}

/** Cada página una sola vez, dentro del documento y con una imagen utilizable. */
function validatePages(pages: OcrInputPage[], pageCount: number): void {
  const seen = new Set<number>()
  for (const page of pages) {
    const n = page.pageNumber
    if (!Number.isInteger(n) || n < 1 || n > pageCount || seen.has(n)) {
      throw new DocumentError('INVALID_PDF', `Página fuera de rango o repetida: ${String(n)}`)
    }
    seen.add(n)
    const sizeOk = [page.imgWidthPx, page.imgHeightPx].every((v) => Number.isFinite(v) && v > 0)
    if (!sizeOk || typeof page.jpegBase64 !== 'string' || page.jpegBase64.length === 0) {
      throw new DocumentError('INVALID_PDF', `Imagen vacía o inválida para la página ${n}`)
    }
  }
}

/** Traduce un fallo de tesseract.js a un error comprensible para el usuario. */
function ocrError(err: unknown): DocumentError {
  if (err instanceof DocumentError) return err
  const message = err instanceof Error ? err.message : String(err)
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT/i.test(`${message} ${cause}`)) {
    return new DocumentError(
      'IO_ERROR',
      'No se pudo descargar el modelo de idioma del OCR. La primera vez hace falta conexión a internet; después queda guardado en el equipo.'
    )
  }
  return new DocumentError('IO_ERROR', `Fallo en el OCR: ${message}`)
}

/** Aplana los bloques de tesseract a una lista de palabras con caja. */
function extractWords(data: { blocks: unknown }): OcrWord[] {
  const words: OcrWord[] = []
  const blocks = (data.blocks ?? []) as Array<{
    paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: OcrWord }> }> }>
  }>
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const word of line.words ?? []) {
          words.push({
            text: word.text,
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1
          })
        }
      }
    }
  }
  return words
}
