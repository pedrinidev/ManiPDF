import { ipcMain, BrowserWindow } from 'electron'
import { SeparationsService } from '../services/separations.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { SeparationMode } from '@shared/ipc-contract'

/** Registra los handlers del módulo "separations" (sin lógica de negocio). */
export function registerSeparationsIpc(service: SeparationsService): void {
  ipcMain.handle(
    IpcChannel.SeparationsRender,
    (_e, args: { id: string; pageNumber: number; dpi: number; mode: SeparationMode }) =>
      handle(() => service.render(args.id, args.pageNumber, args.dpi, args.mode))
  )

  ipcMain.handle(
    IpcChannel.SeparationsExport,
    (event, args: { files: { name: string; pngBase64: string }[] }) =>
      handle(() => service.exportFiles(args.files, BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.SeparationsExportGray, (event, args: { id: string }) =>
    handle(() => service.exportGray(args.id, BrowserWindow.fromWebContents(event.sender)))
  )
}
