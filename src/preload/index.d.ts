import type { AppApi } from '@shared/ipc-contract'

/** Declara `window.api` para que el renderer tenga tipado completo. */
declare global {
  interface Window {
    api: AppApi
  }
}

export {}
