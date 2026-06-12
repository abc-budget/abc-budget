import { EngineStatusBanner } from '../app/chrome/EngineStatusBanner';
import type { UpdateSWFn } from '../app/chrome/EngineStatusBanner';
import { LangProvider } from '../app/i18n/LangProvider';
import { AppRouter } from '../app/router';
import { engine, engineReady } from '../engine';

/** App shell. `updateSW` is registerSW's update function (main.tsx wires it) —
 *  the contract-mismatch state rides the SW update mechanism, not a bare reload. */
export function App({ updateSW }: { updateSW: UpdateSWFn }) {
  return (
    <LangProvider>
      <EngineStatusBanner client={engine} ready={engineReady} updateSW={updateSW} />
      <AppRouter />
    </LangProvider>
  );
}
