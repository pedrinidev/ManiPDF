import { ipcMain } from 'electron'
import { PrintService } from '../services/print.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'

/** Registra los handlers del módulo "print" (sin lógica de negocio). */
export function registerPrintIpc(service: PrintService): void {
  ipcMain.handle(IpcChannel.DocumentPrint, (_e, args: { id: string }) =>
    handle(() => service.print(args.id))
  )
}
