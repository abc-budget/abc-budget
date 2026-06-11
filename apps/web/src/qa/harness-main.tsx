import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/altus/altus.css';
import '../ui/altus/altus-components.css';
import { Harness } from './Harness';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
