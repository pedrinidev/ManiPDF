import { ipcMain, BrowserWindow } from 'electron'
import { PagesService } from '../services/pages.service'
import { handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { RotationDelta } from '@shared/ipc-contract'

/**
 * Registra los handlers del módulo "pages".
 * Sin lógica: extraen args, llaman al service y envuelven en IpcResult.
 */
export function registerPagesIpc(service: PagesService): void {
  ipcMain.handle(
    IpcChannel.PagesRotate,
    (_e, args: { id: string; pageIndices: number[]; delta: RotationDelta }) =>
      handleExclusive(args.id, () => service.rotate(args.id, args.pageIndices, args.delta))
  )

  ipcMain.handle(IpcChannel.PagesDelete, (_e, args: { id: string; pageIndices: number[] }) =>
    handleExclusive(args.id, () => service.remove(args.id, args.pageIndices))
  )

  ipcMain.handle(IpcChannel.PagesReorder, (_e, args: { id: string; order: number[] }) =>
    handleExclusive(args.id, () => service.reorder(args.id, args.order))
  )

  ipcMain.handle(IpcChannel.PagesDuplicate, (_e, args: { id: string; pageIndices: number[] }) =>
    handleExclusive(args.id, () => service.duplicate(args.id, args.pageIndices))
  )

  ipcMain.handle(IpcChannel.PagesInsert, (event, args: { id: string; atIndex: number }) =>
    handleExclusive(args.id, () => service.insert(args.id, args.atIndex, BrowserWindow.fromWebContents(event.sender)))
  )

  ipcMain.handle(IpcChannel.PagesExtract, (event, args: { id: string; pageIndices: number[] }) =>
    handleExclusive(args.id, () =>
      service.extract(args.id, args.pageIndices, BrowserWindow.fromWebContents(event.sender))
    )
  )
}
