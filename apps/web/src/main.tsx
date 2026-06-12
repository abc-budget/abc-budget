import './ui/altus/altus.css';
import './ui/altus/altus-components.css';
import './app/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';

// Captured: EngineStatusBanner triggers the SW update check through THIS
// function on contract-mismatch (2.6 decision 2 — never a bare location.reload).
const updateSW = registerSW({ immediate: true });

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <App updateSW={updateSW} />
  </StrictMode>,
);
