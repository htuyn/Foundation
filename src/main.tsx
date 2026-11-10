import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { ScannerBasketProvider } from './features/scanner/ScannerBasketContext'
import { AuthProvider } from './features/auth/AuthContext'
import './styles.css'

document.documentElement.dataset.theme = 'light'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ScannerBasketProvider>
          <App />
        </ScannerBasketProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
