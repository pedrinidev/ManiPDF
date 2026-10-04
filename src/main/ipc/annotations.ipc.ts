import { ipcMain, BrowserWindow } from 'electron'
import { AnnotationsService } from '../services/annotations.service'
import { handle, handleExclusive } from './handle'
import { IpcChannel } from '@shared/ipc-contract'
import type { Annotation } from '@shared/ipc-contract'

/** Registra los handlers del módulo "annotations" (sin lógica de negocio). */
export function registerAnnotationsIpc(service: AnnotationsService): void {
  ipcMain.handle(
    IpcChannel.AnnotationsBurn,
    (_e, args: { id: string; annotations: Annotation[] }) =>
      handleExclusive(args.id, () => service.burn(args.id, args.annotations))
  )

  ipcMain.handle(IpcChannel.AnnotationsPickImage, (event) =>
    handle(() => service.pickImage(BrowserWindow.fromWebContents(event.sender)))
  )
}
