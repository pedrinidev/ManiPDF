import { ipcMain, BrowserWindow } from 'electron'
import { CompareService } from '../services/compare.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'

/** Registra los handlers del módulo "compare" (sin lógica de negocio). */
export function registerCompareIpc(service: CompareService): void {
  ipcMain.handle(IpcChannel.ComparePick, (event) =>
    handle(() => service.pick(BrowserWindow.fromWebContents(event.sender)))
  )
}
