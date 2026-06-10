import './ui/altus/altus.css';
import './ui/altus/altus-components.css';
import './app/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';

registerSW({ immediate: true });

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
