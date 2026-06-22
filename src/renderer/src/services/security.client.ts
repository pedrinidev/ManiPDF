import type { DocumentId, ProtectOptions } from '@shared/ipc-contract'
import { ClientError } from './document.client'

/** Cliente del módulo "security". La UI nunca llama a window.api directamente. */
class SecurityClient {
  async protect(id: DocumentId, options: ProtectOptions): Promise<string> {
    const result = await window.api.security.protect(id, options)
    if (result.ok) return result.data.filePath
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const securityClient = new SecurityClient()
