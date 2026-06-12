/**
 * Spike WorkerTransport — proves the EngineClient contract survives a thread hop.
 *
 * THIS IS THE v1 SPIKE; it will be replaced by the production WorkerTransport in
 * Task 3 (which adds: handshake gate, drain semantics, per-request timeouts,
 * progress-liveness, respawn-on-death).
 *
 * Only ping + getVersion are implemented here to satisfy the existing seam test.
 * The grown EngineClient interface (session methods + onEvent) is NOT implemented
 * in this spike — Task 3 does the full rewrite.
 */

import type { EngineClient, EngineVersion, EngineEventPayload, ImportStartResult, ApplyColumnResult, ImportNextResult } from './engine-client';
import type { EngineMethod, EngineRequest, EngineResponse } from './protocol';
import type { Stage2SnapshotDTO, RowWindowDTO } from './dto';
import type { DecodeResult } from '../internal/ingest/types';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Builds an EngineClient backed by a Worker over postMessage. Spike/test only —
 * not exported from the package barrel. Proves the EngineClient contract is
 * identical whether the engine runs in-thread or in a worker (NFR-003 relocation
 * seam). Task 3 replaces this with the production WorkerTransport.
 */
export function createWorkerEngineClient(worker: Worker): EngineClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  worker.onmessage = (event: MessageEvent<EngineResponse>) => {
    const { id, ok, value, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(value);
    else entry.reject(new Error(typeof error === 'string' ? error : 'engine worker error'));
  };

  const call = (method: EngineMethod, args: unknown[]): Promise<unknown> => {
    const id = nextId++;
    const request: EngineRequest = { kind: 'req', id, method, args };
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(request);
    });
  };

  // Spike: only ping + getVersion are wired; session methods throw (Task 3 wires them)
  const notImplemented = (name: string) => (): never => {
    throw new Error(`${name}: not implemented in spike worker client (Task 3)`);
  };

  return {
    ping: (message) => call('ping', [message]) as Promise<string>,
    getVersion: () => call('getVersion', []) as Promise<EngineVersion>,
    decode: notImplemented('decode'),
    importStart: notImplemented('importStart'),
    importApplyColumn: notImplemented('importApplyColumn'),
    importResetColumn: notImplemented('importResetColumn'),
    importConfirmRecall: notImplemented('importConfirmRecall'),
    importResolveCollision: notImplemented('importResolveCollision'),
    importGetRows: notImplemented('importGetRows'),
    importNext: notImplemented('importNext'),
    importAbort: notImplemented('importAbort'),
    onEvent(_cb: (event: EngineEventPayload) => void): () => void {
      return () => { /* no-op in spike */ };
    },
  };
}

// Type-check stubs for the not-implemented methods (ensure interface shapes compile)
type _DecodeStub = (b: ArrayBuffer, f: string) => Promise<DecodeResult>;
type _ImportStartStub = (r: Record<string, unknown>[]) => Promise<ImportStartResult>;
type _ApplyColStub = (s: string, c: string, d: string, p: Record<string, unknown> | null) => Promise<ApplyColumnResult>;
type _ResetColStub = (s: string, c: string) => Promise<Stage2SnapshotDTO>;
type _GetRowsStub = (s: string, o: number, c: number) => Promise<RowWindowDTO>;
type _ImportNextStub = (s: string) => Promise<ImportNextResult>;
void (null as unknown as _DecodeStub | _ImportStartStub | _ApplyColStub | _ResetColStub | _GetRowsStub | _ImportNextStub);
