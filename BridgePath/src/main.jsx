import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BridgeProvider } from './context/BridgeContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BridgeProvider>
    <App />
    </BridgeProvider>
  </StrictMode>,
);
