import { ClientError } from './document.client'

/** Cliente del módulo "compare". La UI nunca llama a window.api directamente. */
class CompareClient {
  async pick(): Promise<{ dataBase64: string; fileName: string }> {
    const result = await window.api.compare.pick()
    if (result.ok) return result.data
    throw new ClientError(result.error.code, result.error.message)
  }
}

export const compareClient = new CompareClient()
