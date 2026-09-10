// Node globals (Buffer/process) must exist before web3.js / anchor / the $HUB SDK evaluate.
import '@/lib/bufferPolyfill'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initTheme } from '@/lib/theme'

// Apply the stored terminal theme before first paint (no dark flash).
initTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)