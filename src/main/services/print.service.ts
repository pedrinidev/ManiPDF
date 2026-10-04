import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { DocumentService, DocumentError } from './document.service'
import { makeTempDir } from './temp'
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

  async print(id: DocumentId, parent: BrowserWindow | null): Promise<{ printed: boolean }> {
    const doc = this.documents.getDocument(id)

    const dir = await makeTempDir('print')
    const file = join(dir, 'document.pdf')

    const printer = new BrowserWindow({
      show: false,
      width: 900,
      height: 720,
      title: `Imprimir — ${doc.fileName}`,
      backgroundColor: '#ffffff',
      // Ventana HIJA de la principal: queda SIEMPRE delante (no se va detrás de
      // ManiPDF), pero conserva su barra de título y botón de cerrar. No la hacemos
      // `modal` porque en macOS eso la convierte en una "hoja" SIN botón de cerrar
      // y dejaría al usuario sin forma de cancelar la previsualización.
      parent: parent ?? undefined,
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
    // Cerrar la previsualización con Esc (además del botón de cerrar de la ventana).
    printer.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !printer.isDestroyed()) {
        printer.close()
      }
    })

    // Si el usuario vuelve a ManiPDF con la previsualización abierta: beep del
    // sistema + traemos la ventana de impresión al frente ("atiende esto primero").
    if (parent) {
      let closing = false
      printer.once('close', () => {
        closing = true
      })
      const onParentFocus = (): void => {
        if (closing || printer.isDestroyed()) return
        shell.beep()
        printer.focus()
      }
      parent.on('focus', onParentFocus)
      printer.once('closed', () => parent.removeListener('focus', onParentFocus))
    }

    try {
      await writeFile(file, doc.bytes)
      await printer.loadFile(file)
      // Margen para que el plugin termine de pintar la primera página.
      await delay(500)

      return await new Promise<{ printed: boolean }>((resolve) => {
        let settled = false
        const done = (printed: boolean): void => {
          if (settled) return
          settled = true
          resolve({ printed })
        }
        // Si el usuario cierra la ventana (botón cerrar / Esc), no dejamos la
        // promesa colgada: la resolvemos como "no impreso".
        printer.once('closed', () => done(false))

        printer.webContents.print({ silent: false }, (success, reason) => {
          if (!success && reason && reason !== 'cancelled') {
            // No se pudo abrir el diálogo automáticamente (p. ej. sin impresoras
            // configuradas): dejamos la ventana abierta para imprimir a mano o
            // "Guardar como PDF" desde el visor. No lo tratamos como error.
            done(false)
            return
          }
          if (!printer.isDestroyed()) printer.close()
          done(success)
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
