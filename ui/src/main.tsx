import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function dismissLoader() {
  const loader = document.getElementById('clawos-loader')
  if (loader) {
    loader.style.opacity = '0'
    setTimeout(() => loader.remove(), 500)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onReady={dismissLoader} />
  </StrictMode>,
)
