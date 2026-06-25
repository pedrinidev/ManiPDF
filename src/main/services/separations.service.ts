import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { join as joinPath } from 'node:path'
import type { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { FileService } from './file.service'
import { resolveGhostscript, ghostscriptMissingMessage } from './ghostscript'
import type { DocumentId, InkCoverage, SeparationSpace, SeparationMode } from '@shared/ipc-contract'

const execFileAsync = promisify(execFile)

/**
 * Lógica del módulo "separations": separación de colores real con Ghostscript.
 * Usa el device `tiffsep`, que genera una plancha (TIFF gris) por tinta —CMYK y
 * tintas planas— respetando el color real del PDF. Es el método fiable para
 * prepress. El renderer decodifica los TIFF (utif) y los muestra.
 */
export class SeparationsService {
  constructor(
    private readonly documents: DocumentService,
    private readonly files: FileService
  ) {}

  /**
   * Exporta el documento completo a un PDF en escala de grises usando Ghostscript
   * (`pdfwrite` + ColorConversionStrategy=Gray). Conserva texto/vectores/calidad
   * (no rasteriza), al estilo de "exportar en grises" de InDesign.
   */
  async exportGray(
    id: DocumentId,
    window: BrowserWindow | null
  ): Promise<{ filePath: string; ink: InkCoverage | null }> {
    const gs = resolveGhostscript()
    if (!gs) throw new DocumentError('GHOSTSCRIPT_MISSING', ghostscriptMissingMessage())
    const doc = this.documents.getDocument(id)
    const suggested = doc.fileName.replace(/\.pdf$/i, '') + '-grises.pdf'
    const target = await this.files.pickSavePath(window, suggested)
    if (!target) throw new DocumentError('CANCELLED', 'Exportación cancelada por el usuario')

    const dir = await mkdtemp(join(tmpdir(), 'pdfgray-'))
    const input = join(dir, 'input.pdf')
    try {
      await writeFile(input, doc.bytes)
      // ColorConversionStrategy=Gray + DeviceGray → todo a una sola tinta negra
      // (canal K). Conserva vectores y texto (no rasteriza).
      await execFileAsync(gs, [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        '-sDEVICE=pdfwrite',
        '-sProcessColorModel=DeviceGray',
        '-sColorConversionStrategy=Gray',
        '-dOverrideICC',
        '-dAutoRotatePages=/None',
        `-sOutputFile=${target}`,
        input
      ])
      // Verificación real de que el resultado es solo K (C/M/Y a cero).
      const ink = await measureInkCoverage(gs, target).catch(() => null)
      return { filePath: target, ink }
    } catch (err) {
      throw new DocumentError('IO_ERROR', `Fallo al exportar a negro: ${describe(err)}`)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Escribe las imágenes de separación (PNG base64) en una carpeta elegida. */
  async exportFiles(
    files: { name: string; pngBase64: string }[],
    window: BrowserWindow | null
  ): Promise<{ dir: string; count: number }> {
    if (files.length === 0) {
      throw new DocumentError('IO_ERROR', 'No hay separaciones que exportar')
    }
    const dir = await this.files.pickDirectory(window)
    if (!dir) throw new DocumentError('CANCELLED', 'Exportación cancelada por el usuario')
    try {
      for (const f of files) {
        await this.files.write(joinPath(dir, f.name), Buffer.from(f.pngBase64, 'base64'))
      }
    } catch {
      throw new DocumentError('IO_ERROR', 'No se pudieron escribir las separaciones')
    }
    return { dir, count: files.length }
  }

  /**
   * Renderiza una página al espacio de color adecuado y devuelve el TIFF en base64
   * + el espacio usado; el renderer separa los canales.
   *
   * - CMYK → `tiff32nc` (compuesto CMYK). Usamos tiff32nc y NO tiffsep porque
   *   tiffsep convierte el gris en "negro rico" y ensucia C/M/Y aunque el documento
   *   sea solo K. Contrapartida: las tintas planas se aplanan a CMYK.
   * - RGB → `tiff24nc` (compuesto RGB). Evita forzar un documento RGB a CMYK (que
   *   distorsiona el color al no caber el gamut).
   *
   * `mode='auto'` detecta el espacio original del documento (heurística sobre el PDF).
   */
  async render(
    id: DocumentId,
    pageNumber: number,
    dpi: number,
    mode: SeparationMode
  ): Promise<{ space: SeparationSpace; tiffBase64: string }> {
    const gs = resolveGhostscript()
    if (!gs) throw new DocumentError('GHOSTSCRIPT_MISSING', ghostscriptMissingMessage())

    const doc = this.documents.getDocument(id)
    const space: SeparationSpace = mode === 'auto' ? detectColorSpace(doc.bytes) : mode
    const device = space === 'rgb' ? 'tiff24nc' : 'tiff32nc'

    const dir = await mkdtemp(join(tmpdir(), 'pdfsep-'))
    const input = join(dir, 'input.pdf')
    const output = join(dir, 'page.tif')

    try {
      await writeFile(input, doc.bytes)
      await execFileAsync(gs, [
        '-dBATCH',
        '-dNOPAUSE',
        '-dSAFER',
        `-sDEVICE=${device}`,
        `-r${clampDpi(dpi)}`,
        `-dFirstPage=${pageNumber}`,
        `-dLastPage=${pageNumber}`,
        `-sOutputFile=${output}`,
        input
      ])

      const tif = await readFile(output)
      return { space, tiffBase64: Buffer.from(tif).toString('base64') }
    } catch (err) {
      if (err instanceof DocumentError) throw err
      throw new DocumentError('IO_ERROR', `Fallo al separar colores: ${describe(err)}`)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * Detecta (heurística) si el PDF es predominantemente CMYK o RGB, contando
 * marcadores de espacio de color. No es infalible (los flujos de objetos
 * comprimidos pueden ocultarlos); por eso la UI permite forzar el modo.
 */
function detectColorSpace(bytes: Uint8Array): SeparationSpace {
  const text = Buffer.from(bytes).toString('latin1')
  const cmyk = (text.match(/DeviceCMYK/g) || []).length + (text.match(/\/N\s+4\b/g) || []).length
  const rgb =
    (text.match(/DeviceRGB|CalRGB/g) || []).length + (text.match(/\/N\s+3\b/g) || []).length
  if (cmyk === 0 && rgb === 0) return 'cmyk' // por defecto, flujo de imprenta
  return rgb > cmyk ? 'rgb' : 'cmyk'
}

function clampDpi(dpi: number): number {
  return Math.max(36, Math.min(300, Math.round(dpi) || 150))
}

/**
 * Mide la cobertura de tinta CMYK de un PDF con el device `inkcov` de Ghostscript.
 * Devuelve el MÁXIMO por canal entre todas las páginas (basta con que una página
 * tenga C/M/Y para que no sea "solo negro"). Salida de gs por página:
 *   "0.00000  0.00000  0.00000  0.15018 CMYK OK"
 */
async function measureInkCoverage(gs: string, pdfPath: string): Promise<InkCoverage | null> {
  const { stdout } = await execFileAsync(gs, ['-q', '-o', '-', '-sDEVICE=inkcov', pdfPath])
  const max: InkCoverage = { c: 0, m: 0, y: 0, k: 0 }
  let found = false
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+CMYK/)
    if (!m) continue
    found = true
    max.c = Math.max(max.c, parseFloat(m[1]))
    max.m = Math.max(max.m, parseFloat(m[2]))
    max.y = Math.max(max.y, parseFloat(m[3]))
    max.k = Math.max(max.k, parseFloat(m[4]))
  }
  return found ? max : null
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'error desconocido'
}
