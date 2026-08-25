import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Let the first app frame render before fading out the static loader.
requestAnimationFrame(() => {
  const preloader = document.getElementById('preloader')
  if (!preloader) return

  preloader.classList.add('preloader-hidden')
  window.setTimeout(() => preloader.remove(), 450)
})
