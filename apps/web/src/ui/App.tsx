import { EngineStatusBanner } from '../app/chrome/EngineStatusBanner';
import type { UpdateSWFn } from '../app/chrome/EngineStatusBanner';
import { EngineClientProvider } from '../app/engine-client-context';
import { LangProvider } from '../app/i18n/LangProvider';
import { AppRouter } from '../app/router';
import { engine, engineReady } from '../engine';

/** App shell. `updateSW` is registerSW's update function (main.tsx wires it) —
 *  the contract-mismatch state rides the SW update mechanism, not a bare reload.
 *  EngineClientProvider is THE production injection of the worker-backed client
 *  (screens consume it via useEngineClient — tests inject mocks instead). */
export function App({ updateSW }: { updateSW: UpdateSWFn }) {
  return (
    <LangProvider>
      <EngineClientProvider client={engine}>
        <EngineStatusBanner client={engine} ready={engineReady} updateSW={updateSW} />
        <AppRouter />
      </EngineClientProvider>
    </LangProvider>
  );
}
