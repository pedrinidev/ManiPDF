/// <reference types="vite/client" />
import type { AppApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    api: AppApi
  }
  /** Versión de package.json, inyectada al compilar (electron.vite.config.ts). */
  const __APP_VERSION__: string
}

declare module '*?url' {
  const src: string
  export default src
}
