import { ipcMain, BrowserWindow } from 'electron'
import { DocumentService } from '../services/document.service'
import { handle, handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'

/**
 * Registra los handlers del módulo "document".
 * Cada handler solo: (1) extrae args, (2) llama al service, (3) envuelve.
 * Toda la lógica de negocio vive en DocumentService.
 */
export function registerDocumentIpc(service: DocumentService): void {
  ipcMain.handle(IpcChannel.DocumentOpen, (event) =>
    handle(() => service.open(BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.DocumentOpenPath, (_event, args: { filePath: string }) =>
    handle(() => service.openPath(args.filePath))
  )

  ipcMain.handle(IpcChannel.DocumentSave, (event, args: { id: string }) =>
    handleExclusive(args.id, () => service.save(args.id, BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.DocumentSaveAs, (event, args: { id: string }) =>
    handleExclusive(args.id, () => service.saveAs(args.id, BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.DocumentExportCopy, (event, args: { id: string }) =>
    handleExclusive(args.id, () => service.exportCopy(args.id, BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.DocumentRestore, (_event, args: { id: string; data: Uint8Array }) =>
    handleExclusive(args.id, () => service.restore(args.id, args.data))
  )

  ipcMain.handle(IpcChannel.DocumentMetadata, (_event, args: { id: string }) =>
    handle(() => service.metadata(args.id))
  )

  ipcMain.handle(IpcChannel.DocumentUnlock, (_event, args: { id: string; password: string }) =>
    handleExclusive(args.id, () => service.unlock(args.id, args.password))
  )

  ipcMain.handle(IpcChannel.DocumentClose, (_event, args: { id: string }) =>
    handleExclusive(args.id, () => service.close(args.id))
  )
}
