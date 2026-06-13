export const ENGINE_VERSION = '0.0.0';
// Single source of truth lives in client/protocol.ts (2.7: the previously
// duplicated literal here drifted-by-construction — re-export instead).
export { CONTRACT_VERSION } from '../client/protocol';
