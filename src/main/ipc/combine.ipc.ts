import { ipcMain, BrowserWindow } from 'electron'
import { CombineService } from '../services/combine.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'

/** Registra los handlers del módulo "combine" (sin lógica de negocio). */
export function registerCombineIpc(service: CombineService): void {
  ipcMain.handle(IpcChannel.CombineMerge, (event) =>
    handle(() => service.merge(BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.CombineSplit, (event, args: { id: string; everyN: number }) =>
    handle(() => service.split(args.id, args.everyN, BrowserWindow.fromWebContents(event.sender)))
  )
}
