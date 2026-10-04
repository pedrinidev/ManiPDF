import { ipcMain, BrowserWindow } from 'electron'
import { ConvertService } from '../services/convert.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { ImageFormat, ImagePageSize } from '@shared/ipc-contract'

/** Registra los handlers del módulo "convert" (sin lógica de negocio). */
export function registerConvertIpc(service: ConvertService): void {
  ipcMain.handle(
    IpcChannel.ConvertBeginExport,
    (event, args: { baseName: string; format: ImageFormat; total: number }) =>
      handle(() =>
        service.beginExport(args.baseName, args.format, args.total, BrowserWindow.fromWebContents(event.sender))
      )
  )

  ipcMain.handle(
    IpcChannel.ConvertWriteImage,
    (_e, args: { exportId: string; pageNumber: number; data: Uint8Array }) =>
      handle(() => service.writeImage(args.exportId, args.pageNumber, args.data))
  )

  ipcMain.handle(IpcChannel.ConvertEndExport, (_e, args: { exportId: string }) =>
    handle(() => service.endExport(args.exportId))
  )

  ipcMain.handle(IpcChannel.ConvertImagesToPdf, (event, args: { pageSize?: ImagePageSize } | undefined) =>
    handle(() => service.imagesToPdf(args?.pageSize ?? 'letter', BrowserWindow.fromWebContents(event.sender)))
  )
}
