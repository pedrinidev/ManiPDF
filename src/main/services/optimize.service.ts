import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument } from 'pdf-lib'
import { DocumentService, DocumentError } from './document.service'
import { resolveGhostscript } from './ghostscript'
import type { DocumentId, OpenDocumentDTO, RasterPage } from '@shared/ipc-contract'

const execFileAsync = promisify(execFile)

/**
 * Lógica del módulo "optimize". Dos estrategias de compresión:
 *
 *  - lossless: reconstruye el PDF copiando páginas a un documento nuevo, lo que
 *    descarta objetos huérfanos, y guarda con object streams. Mantiene texto e
 *    imágenes; ganancia modesta.
 *  - rebuildFromImages: reensambla el PDF a partir de páginas ya rasterizadas
 *    a JPEG por el renderer. Reduce mucho en PDFs con imágenes, pero el texto
 *    deja de ser seleccionable (con pérdida).
 *
 * El render a imagen se hace en el renderer (donde está el canvas); aquí solo
 * se reensambla. Así cada proceso hace lo suyo.
 */
export class OptimizeService {
  constructor(private readonly documents: DocumentService) {}

  async lossless(id: DocumentId): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const original = doc.bytes

    // 1) pdf-lib: descarta objetos huérfanos y reescribe con object streams.
    let pdfLibBytes: Uint8Array
    try {
      const src = await PDFDocument.load(original, { ignoreEncryption: true })
      const out = await PDFDocument.create()
      const pages = await out.copyPages(src, src.getPageIndices())
      pages.forEach((p) => out.addPage(p))
      pdfLibBytes = await out.save({ useObjectStreams: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    // 2) Ghostscript (si está): reconstruye la estructura, deduplica imágenes y
    //    recomprime los flujos. CONSERVA la calidad: no remuestrea y deja los
    //    JPEG intactos (passthrough). Suele reducir más que pdf-lib en PDFs reales.
    const gsBytes = await this.optimizeWithGhostscript(original).catch(() => null)

    // Nos quedamos con el más pequeño, y solo si mejora el original.
    const best = [pdfLibBytes, gsBytes]
      .filter((b): b is Uint8Array => b != null && b.length > 0)
      .reduce<Uint8Array>((min, b) => (b.length < min.length ? b : min), original)

    if (best.length < original.length) doc.replaceBytes(best)
    return this.documents.describe(id)
  }

  /**
   * Optimización sin pérdida con Ghostscript: rebuild de estructura conservando
   * resolución e imágenes (sin downsampling, JPEG passthrough, deduplicación).
   * Devuelve null si Ghostscript no está disponible o falla.
   */
  private async optimizeWithGhostscript(bytes: Uint8Array): Promise<Uint8Array | null> {
    const gs = resolveGhostscript()
    if (!gs) return null

    const dir = await mkdtemp(join(tmpdir(), 'manipdf-opt-'))
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.pdf')
    try {
      await writeFile(input, bytes)
      await execFileAsync(gs, [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.7',
        '-dPDFSETTINGS=/default',
        // No remuestrear: conserva la resolución original de las imágenes.
        '-dDownsampleColorImages=false',
        '-dDownsampleGrayImages=false',
        '-dDownsampleMonoImages=false',
        // Mantener los JPEG tal cual (sin recodificar → sin pérdida de imagen).
        '-dPassThroughJPEGImages=true',
        // Reutilizar imágenes repetidas (logos, fondos) una sola vez.
        '-dDetectDuplicateImages=true',
        '-dAutoRotatePages=/None',
        `-sOutputFile=${output}`,
        input
      ])
      const out = await readFile(output)
      return out.length > 0 ? new Uint8Array(out) : null
    } catch {
      return null
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async rebuildFromImages(id: DocumentId, pages: RasterPage[]): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    if (pages.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No se recibió ninguna página rasterizada')
    }

    const out = await PDFDocument.create()
    for (const page of pages) {
      const jpg = await out.embedJpg(Buffer.from(page.jpegBase64, 'base64'))
      const p = out.addPage([page.widthPt, page.heightPt])
      p.drawImage(jpg, { x: 0, y: 0, width: page.widthPt, height: page.heightPt })
    }

    doc.replaceBytes(await out.save({ useObjectStreams: true }))
    return this.documents.describe(id)
  }
}
