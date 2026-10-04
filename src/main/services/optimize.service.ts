import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { DocumentService, DocumentError } from './document.service'
import { resolveGhostscript, ghostscriptEnv, gsOutputPath } from './ghostscript'
import { pruneDeadPages } from './pdf-cleanup'
import { bytesFromBase64 } from './base64'
import { makeTempDir } from './temp'
import type { DocumentId, OpenDocumentDTO, RasterPage } from '@shared/ipc-contract'

const execFileAsync = promisify(execFile)

/**
 * Lógica del módulo "optimize". Dos estrategias de compresión:
 *
 *  - lossless: reescribe el PROPIO documento sin objetos huérfanos y con object
 *    streams (y, si está, prueba Ghostscript). Antes copiaba las páginas a un
 *    documento nuevo: perdía formulario, marcadores, estructura… y «comprimía»
 *    precisamente por perderlos. Ahora un resultado que pierda algo se descarta.
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
    const doc = this.documents.getEditableDocument(id)
    const original = doc.bytes

    // 1) pdf-lib sobre el propio documento: sin objetos huérfanos, con object streams.
    let pdfLibBytes: Uint8Array
    let required: DocumentFeatures
    try {
      const pdf = await PDFDocument.load(original, { ignoreEncryption: true })
      required = documentFeatures(pdf)
      pruneDeadPages(pdf)
      pdfLibBytes = await pdf.save({ useObjectStreams: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }

    // 2) Ghostscript (si está): reconstruye la estructura, deduplica imágenes y
    //    recomprime los flujos sin pérdida. Re-destila el documento, así que su
    //    resultado solo vale si conserva todo lo que tenía el original.
    const gsBytes = await this.optimizeWithGhostscript(original).catch(() => null)
    const candidates = [pdfLibBytes]
    if (gsBytes && (await keepsFeatures(gsBytes, required))) candidates.push(gsBytes)

    // Nos quedamos con el más pequeño, y solo si mejora el original.
    const best = candidates
      .filter((b) => b.length > 0)
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

    const dir = await makeTempDir('opt')
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
        // El resto de imágenes, con compresión sin pérdida (por defecto Ghostscript
        // puede elegir JPEG para las de tono continuo: pérdida de calidad).
        '-dAutoFilterColorImages=false',
        '-dAutoFilterGrayImages=false',
        '-dColorImageFilter=/FlateEncode',
        '-dGrayImageFilter=/FlateEncode',
        // Reutilizar imágenes repetidas (logos, fondos) una sola vez.
        '-dDetectDuplicateImages=true',
        '-dAutoRotatePages=/None',
        `-sOutputFile=${gsOutputPath(output)}`,
        input
      ], { env: ghostscriptEnv() })
      const out = await readFile(output)
      return out.length > 0 ? new Uint8Array(out) : null
    } catch {
      return null
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async rebuildFromImages(
    id: DocumentId,
    pages: RasterPage[],
    baseRevision: number
  ): Promise<OpenDocumentDTO> {
    const doc = this.documents.getEditableDocument(id, baseRevision)
    if (pages.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No se recibió ninguna página rasterizada')
    }

    const out = await PDFDocument.create()
    for (const page of pages) {
      const jpg = await out.embedJpg(bytesFromBase64(page.jpegBase64))
      const p = out.addPage([page.widthPt, page.heightPt])
      p.drawImage(jpg, { x: 0, y: 0, width: page.widthPt, height: page.heightPt })
    }

    doc.replaceBytes(await out.save({ useObjectStreams: true }))
    return this.documents.describe(id)
  }
}

/** Lo que un resultado optimizado «sin pérdida» no debe perder respecto al original. */
interface DocumentFeatures {
  /** Partes del catálogo presentes: formulario, marcadores, estructura, capas… */
  parts: Set<string>
  /** Nº total de anotaciones (enlaces, comentarios, widgets). */
  annotations: number
}

function documentFeatures(pdf: PDFDocument): DocumentFeatures {
  const parts = new Set<string>()
  const catalog = pdf.catalog
  const fields = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  if (fields && fields.size() > 0) parts.add('AcroForm')
  if (catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)?.get(PDFName.of('First'))) parts.add('Outlines')
  for (const key of ['StructTreeRoot', 'OCProperties', 'PageLabels', 'Dests']) {
    if (catalog.get(PDFName.of(key))) parts.add(key)
  }
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  for (const key of ['EmbeddedFiles', 'Dests', 'JavaScript']) {
    if (names?.get(PDFName.of(key))) parts.add(`Names/${key}`)
  }
  let annotations = 0
  for (const page of pdf.getPages()) annotations += page.node.Annots()?.size() ?? 0
  return { parts, annotations }
}

async function keepsFeatures(bytes: Uint8Array, required: DocumentFeatures): Promise<boolean> {
  try {
    const found = documentFeatures(await PDFDocument.load(bytes, { ignoreEncryption: true }))
    return [...required.parts].every((p) => found.parts.has(p)) && found.annotations >= required.annotations
  } catch {
    return false
  }
}
