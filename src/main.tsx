import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { WarehouseProvider } from './data/WarehouseContext'
import { ScannerBasketProvider } from './features/scanner/ScannerBasketContext'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WarehouseProvider>
        <ScannerBasketProvider>
          <App />
        </ScannerBasketProvider>
      </WarehouseProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
