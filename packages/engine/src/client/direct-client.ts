import type { EngineClient } from './engine-client';
import { createPingEngine } from '../internal/ping-engine';
import { initEnginePersistence } from '../internal/persistence/engine-db';

/** Builds an EngineClient that calls the engine directly, in the same thread. */
export function createDirectEngineClient(): EngineClient {
  // Fire-and-forget: opens the engine DB (v1 anchor) + requests durability. Memoized;
  // no-throw where indexedDB is absent. Failure handling hardens in EP-3 (fail-loud).
  void initEnginePersistence();
  return createPingEngine();
}
