import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../altus.css';
import '../altus-components.css';
import { Gallery } from './Gallery';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
