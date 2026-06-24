import { BrowserWindow, ipcMain } from 'electron'
import { PrintService } from '../services/print.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'

/** Registra los handlers del módulo "print" (sin lógica de negocio). */
export function registerPrintIpc(service: PrintService): void {
  ipcMain.handle(IpcChannel.DocumentPrint, (e, args: { id: string }) =>
    // La ventana de impresión se cuelga de la que pidió imprimir (modal hija).
    handle(() => service.print(args.id, BrowserWindow.fromWebContents(e.sender)))
  )
}
