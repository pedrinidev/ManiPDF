/// <reference types="vite/client" />
import type { AppApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    api: AppApi
  }
}

declare module '*?url' {
  const src: string
  export default src
}
