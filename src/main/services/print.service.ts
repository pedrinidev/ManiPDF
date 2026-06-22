import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import type { DocumentId } from '@shared/ipc-contract'

/**
 * Lógica del módulo "print".
 *
 * Imprime el documento ABIERTO (con sus cambios en memoria), no el archivo en
 * disco. Para respetar fielmente el PDF, se vuelca a un temporal y se carga en
 * una ventana con el visor PDF nativo de Chromium (`plugins: true`); desde ahí
 * se abre el diálogo de impresión del sistema.
 *
 * IMPORTANTE: la ventana debe ser VISIBLE. El panel de impresión del SO se
 * ancla a una ventana real; desde una ventana oculta `print()` falla con
 * "No printers available". Mostrarla además da vista previa y permite imprimir
 * a mano (Cmd/Ctrl+P) o "Guardar como PDF" aunque no haya impresoras.
 */
export class PrintService {
  constructor(private readonly documents: DocumentService) {}

  async print(id: DocumentId): Promise<{ printed: boolean }> {
    const doc = this.documents.getDocument(id)

    const dir = await mkdtemp(join(tmpdir(), 'pdfprint-'))
    const file = join(dir, 'document.pdf')

    const printer = new BrowserWindow({
      show: false,
      width: 900,
      height: 720,
      title: `Imprimir — ${doc.fileName}`,
      backgroundColor: '#ffffff',
      webPreferences: {
        plugins: true, // habilita el visor PDF integrado de Chromium
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // El temporal se borra al cerrar la ventana (el visor lo necesita mientras está abierta).
    printer.on('closed', () => {
      void rm(dir, { recursive: true, force: true }).catch(() => {})
    })
    printer.once('ready-to-show', () => printer.show())

    try {
      await writeFile(file, doc.bytes)
      await printer.loadFile(file)
      // Margen para que el plugin termine de pintar la primera página.
      await delay(500)

      return await new Promise<{ printed: boolean }>((resolve) => {
        printer.webContents.print({ silent: false }, (success, reason) => {
          if (!success && reason && reason !== 'cancelled') {
            // No se pudo abrir el diálogo automáticamente (p. ej. sin impresoras
            // configuradas): dejamos la ventana abierta para imprimir a mano o
            // "Guardar como PDF" desde el visor. No lo tratamos como error.
            resolve({ printed: false })
            return
          }
          if (!printer.isDestroyed()) printer.close()
          resolve({ printed: success })
        })
      })
    } catch (err) {
      if (!printer.isDestroyed()) printer.close()
      throw new DocumentError('IO_ERROR', `Fallo al imprimir: ${describe(err)}`)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : 'error desconocido'
}
