import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          // Separa las librerías pesadas en chunks propios: aligeran el chunk
          // principal (parseo más rápido de la app) y se cachean por separado,
          // ya que cambian mucho menos que el código de la app.
          manualChunks: {
            pdfjs: ['pdfjs-dist'],
            utif: ['utif']
          }
        }
      }
    }
  }
})
