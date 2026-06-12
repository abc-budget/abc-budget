import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { EngineClient } from '@abc-budget/engine';

/**
 * The EngineClient seam for screens (2.7) — mirrors the EngineStatusBanner
 * `client` prop pattern, lifted to context because screens mount via the
 * router (no prop path).
 *
 * This module deliberately does NOT import '../engine': importing the wiring
 * point spawns the real Worker at module init (always-worker, 2.6) — jsdom has
 * none.  Production injects the worker-backed client once in ui/App.tsx; tests
 * inject a mock EngineClient and never touch a Worker.
 */
const EngineClientContext = createContext<EngineClient | null>(null);

export function EngineClientProvider({ client, children }: { client: EngineClient; children: ReactNode }) {
  return <EngineClientContext.Provider value={client}>{children}</EngineClientContext.Provider>;
}

export function useEngineClient(): EngineClient {
  const client = useContext(EngineClientContext);
  if (!client) throw new Error('useEngineClient requires <EngineClientProvider>');
  return client;
}
