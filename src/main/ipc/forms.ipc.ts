import { ipcMain } from 'electron'
import { FormsService } from '../services/forms.service'
import { handle, handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { FormFieldValue, NewFormField } from '@shared/ipc-contract'

/** Registra los handlers del módulo "forms" (sin lógica de negocio). */
export function registerFormsIpc(service: FormsService): void {
  ipcMain.handle(IpcChannel.FormsList, (_e, args: { id: string }) =>
    handle(() => service.list(args.id))
  )

  ipcMain.handle(
    IpcChannel.FormsFill,
    (_e, args: { id: string; values: FormFieldValue[]; flatten: boolean }) =>
      handleExclusive(args.id, () => service.fill(args.id, args.values, args.flatten))
  )

  ipcMain.handle(IpcChannel.FormsCreate, (_e, args: { id: string; fields: NewFormField[] }) =>
    handleExclusive(args.id, () => service.create(args.id, args.fields))
  )
}
