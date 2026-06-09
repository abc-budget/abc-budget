import type { EngineClient } from './engine-client';
import { createPingEngine } from '../internal/ping-engine';

/** Builds an EngineClient that calls the engine directly, in the same thread. */
export function createDirectEngineClient(): EngineClient {
  return createPingEngine();
}
