import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Configuración de los tests (vitest). Solo lógica pura (dominio y servicios sin
 * Electron): rápido y sin necesidad de navegador ni proceso de Electron.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
