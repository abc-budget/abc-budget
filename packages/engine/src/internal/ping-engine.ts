import type { EngineClient } from '../client/engine-client';
import { CONTRACT_VERSION, ENGINE_VERSION } from './version';

/** The in-process engine. In EP-2 this is replaced by the IoC-wired prior-art facade adapter. */
export function createPingEngine(): EngineClient {
  return {
    async ping(message) {
      return message;
    },
    async getVersion() {
      return { engine: ENGINE_VERSION, contract: CONTRACT_VERSION };
    },
  };
}
