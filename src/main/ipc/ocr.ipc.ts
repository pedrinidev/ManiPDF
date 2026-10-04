import { ipcMain, BrowserWindow } from 'electron'
import { OcrService } from '../services/ocr.service'
import { handle, handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { OcrInputPage, OcrLang } from '@shared/ipc-contract'

/** Registra los handlers del módulo "ocr" (sin lógica de negocio). */
export function registerOcrIpc(service: OcrService): void {
  ipcMain.handle(IpcChannel.OcrExtract, (_e, args: { lang: OcrLang; images: string[] }) =>
    handle(() => service.extract(args.lang, args.images))
  )

  ipcMain.handle(
    IpcChannel.OcrSearchable,
    (_e, args: { id: string; lang: OcrLang; pages: OcrInputPage[]; baseRevision: number }) =>
      handleExclusive(args.id, () => service.searchable(args.id, args.lang, args.pages, args.baseRevision))
  )

  ipcMain.handle(IpcChannel.OcrSaveText, (event, args: { text: string }) =>
    handle(() => service.saveText(args.text, BrowserWindow.fromWebContents(event.sender)))
  )
}
