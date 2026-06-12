import type { EngineClient } from '../client/engine-client';
import { CONTRACT_VERSION, ENGINE_VERSION } from './version';

/**
 * Returns the minimal in-process ping+getVersion implementation.
 * Used by the direct client (Task 2) and the spike worker (v1 proof).
 *
 * NOTE: this helper only provides `ping` and `getVersion`. The full
 * EngineClient interface is implemented by createDirectEngineClient.
 */
export function createPingEngine(): Pick<EngineClient, 'ping' | 'getVersion'> {
  return {
    async ping(message) {
      return message;
    },
    async getVersion() {
      return { engine: ENGINE_VERSION, contract: CONTRACT_VERSION };
    },
  };
}
