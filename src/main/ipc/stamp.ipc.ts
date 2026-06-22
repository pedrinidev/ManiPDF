import { ipcMain } from 'electron'
import { StampService } from '../services/stamp.service'
import { handle } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { StampConfig } from '@shared/ipc-contract'

/** Registra los handlers del módulo "stamp" (sin lógica de negocio). */
export function registerStampIpc(service: StampService): void {
  ipcMain.handle(IpcChannel.StampApply, (_e, args: { id: string; config: StampConfig }) =>
    handle(() => service.apply(args.id, args.config))
  )
}
