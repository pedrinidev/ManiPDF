import { ipcMain, BrowserWindow } from 'electron'
import { ConvertService } from '../services/convert.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { ImageFormat } from '@shared/ipc-contract'

/** Registra los handlers del módulo "convert" (sin lógica de negocio). */
export function registerConvertIpc(service: ConvertService): void {
  ipcMain.handle(
    IpcChannel.ConvertExportImages,
    (event, args: { format: ImageFormat; images: string[] }) =>
      handle(() =>
        service.exportImages(args.format, args.images, BrowserWindow.fromWebContents(event.sender))
      )
  )

  ipcMain.handle(IpcChannel.ConvertImagesToPdf, (event) =>
    handle(() => service.imagesToPdf(BrowserWindow.fromWebContents(event.sender)))
  )
}
