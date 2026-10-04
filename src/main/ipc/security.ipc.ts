import { ipcMain, BrowserWindow } from 'electron'
import { SecurityService } from '../services/security.service'
import { handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { ProtectOptions } from '@shared/ipc-contract'

/** Registra los handlers del módulo "security" (sin lógica de negocio). */
export function registerSecurityIpc(service: SecurityService): void {
  ipcMain.handle(
    IpcChannel.SecurityProtect,
    (event, args: { id: string; options: ProtectOptions }) =>
      handleExclusive(args.id, () =>
        service.protect(args.id, args.options, BrowserWindow.fromWebContents(event.sender))
      )
  )
}
