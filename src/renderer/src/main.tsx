import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// Marca la plataforma en el body (para dejar hueco a los botones del semáforo en macOS).
document.body.dataset.platform = window.api.system.platform

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el elemento #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
