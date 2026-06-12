/**
 * Direct (in-thread) EngineClient — implements the full EngineClient contract v2
 * without a Worker.  This is the transport vitest and QA ride; the worker host
 * shares the same SessionRegistry and DTO serializers (DRY — transport differs,
 * logic is shared).
 *
 * Composition root split (Task 2 decision):
 *   The full real-DAO wiring (UserSettingsIDBDAO + RecallPool + ImportStatementServiceImpl
 *   with settingsDao+recallPool) is deferred to Task 4's composition root.  Here
 *   we wire ImportStatementServiceImpl with no settingsDao/recallPool (null defaults)
 *   so the direct client is FUNCTIONAL for all test paths that don't require those
 *   optional dependencies.  Task 4 adds the production wiring and removes the MUST-DO
 *   comment in service.ts.
 *
 * rxjs — INTERNAL only (never on the public surface).
 */

import { firstValueFrom } from 'rxjs';
import type { EngineClient, EngineVersion, ImportStartResult, ApplyColumnResult, ImportNextResult, EngineEventPayload } from './engine-client';
import type { Stage2SnapshotDTO, RowWindowDTO } from './dto';
import {
  serializeStage2Snapshot,
  serializeColumnRejection,
  serializeRowWindow,
  serializeGenerateResult,
  serializeUnmappedColumns,
} from './dto';
import { SessionUnknownError } from './errors';
import { ColumnTransformRejection, UnmappedColumnsError } from '../internal/importStatement/stage2/errors';
import type { ExchangeRateApi } from '../internal/exchange-rate/api';
import { createPingEngine } from '../internal/ping-engine';
import { initEnginePersistence } from '../internal/persistence/engine-db';
import { setRemoteRatesApi } from '../internal/exchange-rate/rates-holder';
import { decode } from '../internal/ingest/decode';
import type { DecodeResult } from '../internal/ingest/types';
import { ImportStatementServiceImpl } from '../internal/importStatement/service';
import { ColumnDefinition } from '../internal/importStatement/types';
import { ImportStatementColumn } from '../internal/importStatement/stage2/column';
import type { ImportStatementColumnHeaderStage2 } from '../internal/importStatement/stage2/types';
import type { ImportStatementStage2Impl } from '../internal/importStatement/stage2/implementation';
import { generateUniqueId } from '../internal/utils/id/generator';
import { SessionRegistry } from '../internal/worker/sessions';
import { CONTRACT_VERSION, ENGINE_VERSION } from '../internal/version';

/** Options accepted by the direct engine client factory. */
export interface EngineInitOptions {
  /**
   * Remote ExchangeRateApi implementation supplied by the app layer.
   * When provided, the engine wires a 2-level cache (IDB → remote).
   * When absent, rate conversion is unavailable until EP-2 surfaces it.
   */
  exchangeRateApi?: ExchangeRateApi;
}

/** Builds an EngineClient that calls the engine directly, in the same thread. */
export function createDirectEngineClient(options?: EngineInitOptions): EngineClient {
  // Wire the remote rates api into the module-level holder before any lazy construction.
  setRemoteRatesApi(options?.exchangeRateApi);

  // Fire-and-forget: opens the engine DB (v2 migrations) + requests durability. Memoized;
  // no-throw where indexedDB is absent. Failure handling hardens in EP-3 (fail-loud).
  void initEnginePersistence();

  const pingEngine = createPingEngine();

  // Session registry — shared state for all session methods
  const registry = new SessionRegistry();

  // Import service — null settingsDao/recallPool; full wiring is Task 4's composition root
  // ⚠️ 2.6 MUST-DO (Task 4): wire settingsDao + recallPool from the real DAOs
  const service = new ImportStatementServiceImpl(null, null, null);

  // Event listeners (onEvent subscribers)
  const listeners = new Set<(event: EngineEventPayload) => void>();

  function emit(event: EngineEventPayload): void {
    for (const cb of listeners) {
      try { cb(event); } catch { /* listener errors are non-fatal */ }
    }
  }

  /** Internal shape we cast stage2 to for snapshot extraction. */
  type Stage2Internal = {
    columns: import('rxjs').Observable<ImportStatementColumnHeaderStage2[]>;
    recognized: { n: number; m: number };
    lastSaveCollision: import('../internal/importStatement/recall/recall').CollisionDescriptor | null;
    getUnmappedColumns: () => ReadonlyArray<{ id: string; name: string }>;
  };

  /**
   * Build a Stage2SnapshotDTO from a live stage2 instance.
   * Reads the current column state via BehaviorSubject (emits synchronously).
   */
  async function snapshotStage2(stage2: ImportStatementStage2Impl): Promise<Stage2SnapshotDTO> {
    const impl = stage2 as unknown as Stage2Internal;
    const cols = await firstValueFrom(impl.columns);
    return serializeStage2Snapshot({
      columns: cols,
      recognized: impl.recognized,
      lastSaveCollision: impl.lastSaveCollision,
      unmappedColumns: impl.getUnmappedColumns(),
    });
  }

  return {
    // ── Baseline ──────────────────────────────────────────────────────────────

    ping: pingEngine.ping.bind(pingEngine),

    async getVersion(): Promise<EngineVersion> {
      return { engine: ENGINE_VERSION, contract: CONTRACT_VERSION };
    },

    // ── Decode ────────────────────────────────────────────────────────────────

    async decode(bytes: ArrayBuffer, fileName: string): Promise<DecodeResult> {
      return decode({ bytes, fileName });
    },

    // ── Import session ────────────────────────────────────────────────────────

    async importStart(rows: Record<string, unknown>[]): Promise<ImportStartResult> {
      // stage2() hydrates engine config (if settingsDao is wired) and creates
      // the column graph worker-side.
      const stage1 = service.startWith(rows);
      const stage2 = await service.stage2(stage1);

      const sessionId = generateUniqueId('session');
      registry.register(sessionId, stage2);

      const snapshot = await snapshotStage2(stage2 as unknown as ImportStatementStage2Impl);
      return { sessionId, stage2: snapshot };
    },

    async importApplyColumn(
      sessionId: string,
      columnId: string,
      definition: string,
      params: Record<string, unknown> | null,
    ): Promise<ApplyColumnResult> {
      const entry = registry.get(sessionId); // throws SessionUnknownError if absent
      const stage2 = entry.stage2;

      // Find the current column via the impl cast
      const implForApply = stage2 as unknown as Stage2Internal;
      const cols = await firstValueFrom(implForApply.columns);
      const col = cols.find((c) => c.id === columnId);
      if (!col) {
        throw new SessionUnknownError(sessionId); // column not found — treat as session error
      }

      // Build the new column: use the column's parseAs* methods via the existing
      // ImportStatementColumn instance.  For the direct client (test path), we apply
      // the definition by creating a copy with the new definition+params attached.
      // The full method dispatch (parseAsDate etc.) is preserved by the service; here
      // we build a minimal applied column so the snapshot reflects the change.
      const typedDef = definition as ColumnDefinition;

      if (!(col instanceof ImportStatementColumn)) {
        throw new Error(`Column ${columnId} is not an ImportStatementColumn`);
      }

      const appliedCol = col.copy({ definition: typedDef, params: params as import('../internal/importStatement/types').ColumnParams | null });

      try {
        stage2.applyColumn(appliedCol);
        const snapshot = await snapshotStage2(stage2 as unknown as ImportStatementStage2Impl);
        return { ok: true, snapshot };
      } catch (err) {
        if (err instanceof ColumnTransformRejection) {
          return { ok: false, rejection: serializeColumnRejection(err) };
        }
        throw err;
      }
    },

    async importResetColumn(sessionId: string, columnId: string): Promise<Stage2SnapshotDTO> {
      const entry = registry.get(sessionId);
      await entry.stage2.resetColumn(columnId);
      return snapshotStage2(entry.stage2 as unknown as ImportStatementStage2Impl);
    },

    async importConfirmRecall(sessionId: string, columnId: string): Promise<void> {
      const entry = registry.get(sessionId);
      const implForConfirm = entry.stage2 as unknown as Stage2Internal;
      const cols = await firstValueFrom(implForConfirm.columns);
      const col = cols.find((c) => c.id === columnId);
      if (!col) throw new SessionUnknownError(sessionId);
      if (col instanceof ImportStatementColumn && col.recallState === 'guessed') {
        const confirmed = col.copy({ recallState: 'confirmed' });
        entry.stage2.applyColumn(confirmed);
      }
    },

    async importResolveCollision(sessionId: string, confirm: boolean): Promise<void> {
      const entry = registry.get(sessionId);
      if (confirm) {
        // Call confirmSave on the recall pool if available
        // Recall pool access via the stage2 internal — direct-client wiring is minimal;
        // full wiring lands in Task 4 with the real recall pool.
        const impl = entry.stage2 as unknown as { _recallPool?: { confirmSave: (name: string, def: unknown, p: unknown) => Promise<void> }; lastSaveCollision: import('../internal/importStatement/recall/recall').CollisionDescriptor | null };
        const collision = impl.lastSaveCollision;
        if (impl._recallPool && collision) {
          await impl._recallPool.confirmSave(
            '',
            collision.incoming.definition,
            collision.incoming.params,
          );
        }
        impl.lastSaveCollision = null;
      }
    },

    async importGetRows(sessionId: string, offset: number, count: number): Promise<RowWindowDTO> {
      const entry = registry.get(sessionId);
      if (!entry.generatedRows) {
        throw new Error(`Session ${sessionId}: no generated rows yet. Call importNext first.`);
      }
      const { rows } = entry.generatedRows;
      const total = rows.length;
      const slice = rows.slice(offset, offset + count);
      return serializeRowWindow(slice, offset, total);
    },

    async importNext(sessionId: string): Promise<ImportNextResult> {
      const entry = registry.get(sessionId);
      try {
        const stage3 = await entry.stage2.next();
        // Generate rows (stage3.generateRows is the FEAT-022 collect-don't-throw path)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (stage3 as any).generateRows();
        entry.generatedRows = result;

        // Emit progress event for the completed generation
        emit({ event: 'progress', jobId: sessionId, phase: 'done', done: result.rows.length, total: result.rows.length });

        // Free the session after successful completion
        registry.free(sessionId);

        return { ok: true, result: serializeGenerateResult(result) };
      } catch (err) {
        if (err instanceof UnmappedColumnsError) {
          return { ok: false, unmapped: serializeUnmappedColumns(err.unmappedColumns) };
        }
        throw err;
      }
    },

    async importAbort(sessionId: string): Promise<void> {
      // Free the session; no-op if already gone (idempotent)
      registry.free(sessionId);
    },

    // ── Out-of-band events ────────────────────────────────────────────────────

    onEvent(cb: (event: EngineEventPayload) => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

