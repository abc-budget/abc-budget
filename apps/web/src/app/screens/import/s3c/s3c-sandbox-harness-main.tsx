/**
 * DEV-ONLY entry for the engaged-sandbox S3c layout harness (Task 8 Part C).
 * Open via its Vite HTML entry — see `apps/web/s3c-sandbox-harness.html`.
 * Run `pnpm --filter @abc-budget/web dev` then visit:
 *   http://localhost:5173/s3c-sandbox-harness.html
 */
import '../../../../ui/altus/altus.css';
import '../../../../ui/altus/altus-components.css';
import '../../../app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { S3cSandboxHarness } from './S3cSandboxHarness';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root not found');

createRoot(rootElement).render(
  <StrictMode>
    <S3cSandboxHarness />
  </StrictMode>,
);
