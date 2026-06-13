/**
 * jsdom ↔ undici realm bridge (2.7 — the data-router migration).
 *
 * react-router's data router builds a `new Request(href, { signal })` per
 * navigation. Under vitest's jsdom environment the global Request is Node's
 * (undici) while AbortController is jsdom's — undici brand-checks the signal
 * ("Expected signal to be an instance of AbortSignal") and every navigation
 * explodes. Swap the jsdom AbortController/AbortSignal globals for Node's
 * (recovered via util.transferableAbortController — the class itself is not
 * importable). Nothing in the app or jsdom relies on jsdom's implementation.
 */
import { transferableAbortController } from 'node:util';

const nodeController = transferableAbortController();
const NodeAbortController = nodeController.constructor as typeof AbortController;
const NodeAbortSignal = nodeController.signal.constructor as typeof AbortSignal;

globalThis.AbortController = NodeAbortController;
globalThis.AbortSignal = NodeAbortSignal;
