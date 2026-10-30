import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { pdfjs } from 'react-pdf';
import { installSessionRenewal } from './lib/session'

// Set worker source to use local file (revert to original working configuration)
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

// Before any request goes out: a 401 from the API renews the session and retries
installSessionRenewal()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
