import { ipcMain } from 'electron'
import { OptimizeService } from '../services/optimize.service'
import { handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { RasterPage } from '@shared/ipc-contract'

/** Registra los handlers del módulo "optimize" (sin lógica de negocio). */
export function registerOptimizeIpc(service: OptimizeService): void {
  ipcMain.handle(IpcChannel.OptimizeLossless, (_e, args: { id: string }) =>
    handleExclusive(args.id, () => service.lossless(args.id))
  )

  ipcMain.handle(
    IpcChannel.OptimizeRebuildFromImages,
    (_e, args: { id: string; pages: RasterPage[]; baseRevision: number }) =>
      handleExclusive(args.id, () => service.rebuildFromImages(args.id, args.pages, args.baseRevision))
  )
}
