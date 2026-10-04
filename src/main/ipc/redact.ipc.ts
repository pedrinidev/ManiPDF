import { ipcMain } from 'electron'
import { RedactService } from '../services/redact.service'
import { handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { RedactedPage } from '@shared/ipc-contract'

/** Registra los handlers del módulo "redact" (sin lógica de negocio). */
export function registerRedactIpc(service: RedactService): void {
  ipcMain.handle(
    IpcChannel.RedactApply,
    (_e, args: { id: string; pages: RedactedPage[]; baseRevision: number }) =>
      handleExclusive(args.id, () => service.apply(args.id, args.pages, args.baseRevision))
  )
}
