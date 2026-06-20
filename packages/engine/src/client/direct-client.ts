/**
 * Direct (in-thread) EngineClient — implements the full EngineClient contract v5
 * without a Worker.  This is the transport vitest and QA ride; the worker host
 * (`internal/worker/engine-worker-host.ts`) is a wire shim over THIS client, so
 * both transports run the identical session logic and the identical composed
 * object graph.
 *
 * Composition (Story 2.6, Task 4): the production object graph comes from the
 * ONE shared composition root — `composeEngine()` in
 * `internal/worker/composition-root.ts` — which wires the real
 * UserSettingsIDBDAO + recall pool + rates holder into
 * ImportStatementServiceImpl.  Where indexedDB is absent the root composes
 * with nulls (deterministic node baseline), never throws.
 *
 * Session semantics (founder refinement 1+2):
 *   - ≤1 active session (SessionRegistry) — importStart while active throws
 *     SessionAlreadyActiveError.
 *   - importApplyColumn returns the COLUMN-STATE snapshot only (row economy);
 *     full rows flow through windowed importGetRows.
 *   - importAbort frees the session graph (the SOLE free path now). DECLARED
 *     CHANGE (2.8 decision #4): completed importNext NO LONGER frees — it flushes
 *     the staged recall writes and leaves the session live for S3c to reuse.
 *
 * Progress events (HC-10 honest counts): decode and importNext emit
 * `progress {jobId, phase, done, total}` via onEvent — done is monotone,
 * the final event always reports done === total.
 *
 * rxjs — INTERNAL only (never on the public surface).
 */

import { firstValueFrom } from 'rxjs';
import type {
  EngineClient,
  EngineVersion,
  ImportStartResult,
  ApplyColumnResult,
  ImportNextResult,
  EngineEventPayload,
} from './engine-client';
import type {
  Stage2SnapshotDTO,
  RowWindowDTO,
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  CategorizedWindowDTO,
  WhyTreeDTO,
  RuleSummaryDTO,
  EditActionDTO,
  SandboxStateDTO,
  RemainderMagnitudeDTO,
  TypicalityResultDTO,
  CommitResultDTO,
  ReviewWindowDTO,
} from './dto';
import {
  serializeStage2Snapshot,
  serializeColumnRejection,
  serializeRowWindow,
  serializeGenerateResult,
  serializeUnmappedColumns,
} from './dto';
import { SessionUnknownError } from './errors';
import { ColumnTransformRejection } from '../internal/importStatement/stage2/errors';
import type { ExchangeRateApi } from '../internal/exchange-rate/api';
import { bulkWarmRates } from '../internal/exchange-rate/rates-holder';
import { createPingEngine } from '../internal/ping-engine';
import { composeEngine } from '../internal/worker/composition-root';
import type { ComposedEngine } from '../internal/worker/composition-root';
import type { CategorizationService } from '../internal/worker/categorization-service';
import { decode } from '../internal/ingest/decode';
import type { DecodeResult } from '../internal/ingest/types';
import { parseColumnByDefinition } from '../internal/importStatement/stage2/parse-by-definition';
import { ImportStatementColumn } from '../internal/importStatement/stage2/column';
import type { ImportStatementColumnHeaderStage2, ImportStatementRowData } from '../internal/importStatement/stage2/types';
import type { ImportStatementStage2Impl } from '../internal/importStatement/stage2/implementation';
import { generateRows } from '../internal/importStatement/stage3/row-generator';
import type { ColumnInfo } from '../internal/importStatement/stage3/row-generator';
import type { GenerateRowsResult } from '../internal/importStatement/stage3/types';
import {
  getBaseCurrency,
  getBaseCurrencyOrNull,
  setBaseCurrency,
  BaseCurrencyNotSetError,
  InvalidBaseCurrencyError,
} from '../internal/settings/base-currency';
import { getCurrency } from '../internal/currency/reference';
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

/** Internal shape we cast stage2 to for snapshot extraction. */
type Stage2Internal = {
  columns: import('rxjs').Observable<ImportStatementColumnHeaderStage2[]>;
  recognized: { n: number; m: number };
  lastSaveCollision: import('../internal/importStatement/recall/recall').CollisionDescriptor | null;
  getUnmappedColumns: () => ReadonlyArray<{ id: string; name: string }>;
};

/** Builds an EngineClient that calls the engine directly, in the same thread. */
export function createDirectEngineClient(options?: EngineInitOptions): EngineClient {
  const pingEngine = createPingEngine();

  // Session registry — shared state for all session methods
  const registry = new SessionRegistry();

  // ── Composition root (ONE shared root — Task 4) ───────────────────────────
  // Async composition is memoized here; methods that need the composed graph
  // await it.  ping/getVersion/decode do not block on it.
  //
  // 4.9a S3c: the composed CategorizationService reads a session's stage3 rows
  // through a late-bound accessor — the SessionRegistry lives HERE (the
  // transport), so we wire the registry-backed accessor onto the graph once it
  // resolves. The accessor REUSES generateForSession (the cached typed rows
  // importGetRows serves) — it never re-runs the pipeline.
  const composedPromise: Promise<ComposedEngine> = composeEngine({
    exchangeRateApi: options?.exchangeRateApi,
  }).then((composed) => {
    composed.setSessionRowsAccessor(async (sessionId: string) => {
      const entry = registry.get(sessionId); // throws SessionUnknownError if absent
      const { rows } = await generateForSession(entry);
      return rows;
    });
    composed.setSessionReviewAccessor(async (sessionId: string) => {
      const entry = registry.get(sessionId); // throws SessionUnknownError if absent
      const { rows, rowErrors, skipped } = await generateForSession(entry);
      const stage2 = entry.stage2 as ImportStatementStage2Impl;
      const impl = stage2 as unknown as Stage2Internal;
      const cols = await firstValueFrom(impl.columns);
      const stage2Rows = await firstValueFrom(stage2.currentData);
      const columns: ColumnInfo[] = cols.map((c) => ({ id: c.id, definition: c.definition, params: c.params }));
      return { rows, rowErrors, skipped, stage2Rows, columns };
    });
    return composed;
  });

  // Event listeners (onEvent subscribers)
  const listeners = new Set<(event: EngineEventPayload) => void>();

  function emit(event: EngineEventPayload): void {
    for (const cb of listeners) {
      try { cb(event); } catch { /* listener errors are non-fatal */ }
    }
  }

  function emitProgress(jobId: string, phase: string, done: number, total: number): void {
    emit({ event: 'progress', jobId, phase, done, total });
  }

  /**
   * Build a Stage2SnapshotDTO from a live stage2 instance.
   * Reads the current column state via BehaviorSubject (emits synchronously).
   * Row economy: the serializer caps per-column sample cells — snapshot size
   * does NOT scale with row count.
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

  /** Find a live column instance by id; throws when absent. */
  async function findColumn(
    stage2: ImportStatementStage2Impl,
    sessionId: string,
    columnId: string,
  ): Promise<ImportStatementColumn> {
    const impl = stage2 as unknown as Stage2Internal;
    const cols = await firstValueFrom(impl.columns);
    const col = cols.find((c) => c.id === columnId);
    if (!col || !(col instanceof ImportStatementColumn)) {
      // Unknown column id within a known session — surface as a loud error with
      // the session context (the UI sends ids it got from the snapshot).
      throw new SessionUnknownError(`${sessionId}:column:${columnId}`);
    }
    return col;
  }

  /**
   * Generate (or reuse the cached) typed rows for a session.
   *
   * Used by BOTH importGetRows (windowed preview once all columns are mapped)
   * and importNext (full result + session completion).  The cache is invalidated
   * on every applyColumn/resetColumn (generatedRows = null).
   *
   * @throws BaseCurrencyNotSetError when no base currency is configured (the
   *         2.7 gate sets it before any import begins — loud by design).
   */
  async function generateForSession(
    entry: import('../internal/worker/sessions').SessionEntry,
    onProgress?: (done: number, total: number) => void,
  ): Promise<GenerateRowsResult> {
    if (entry.generatedRows) {
      // Cache hit (e.g. importGetRows already generated for this column state):
      // still report the honest final count — done === total, HC-10.
      const total = entry.generatedSourceTotal ?? 0;
      onProgress?.(total, total);
      return entry.generatedRows;
    }
    const stage2 = entry.stage2 as ImportStatementStage2Impl;
    const impl = stage2 as unknown as Stage2Internal;

    const { settingsDao } = await composedPromise;
    if (settingsDao === null) {
      // No persistence → no base currency can exist. Loud, structured.
      throw new BaseCurrencyNotSetError();
    }
    const baseCurrency = await getBaseCurrency(settingsDao); // throws BaseCurrencyNotSetError when unset

    const cols = await firstValueFrom(impl.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const columnInfo: ColumnInfo[] = cols.map((c) => ({
      id: c.id,
      definition: c.definition,
      params: c.params,
    }));

    const result = await generateRows(rows, columnInfo, baseCurrency, onProgress);
    entry.generatedRows = result;
    entry.generatedSourceTotal = rows.length;
    return result;
  }

  /**
   * Resolve the composed CategorizationService (contract v5 — 4.9b sandbox).
   * Task 1 (contract) leaves it null; sibling Task 2 wires the real impl in the
   * composition root. Until then this throws LOUD (HC-7) — a categorization call
   * before Task 2 must never look like an empty success.
   */
  async function resolveCategorization(): Promise<CategorizationService> {
    const { categorization } = await composedPromise;
    if (categorization === null) {
      throw new Error(
        '[abc-engine] Categorization surface is not wired (contract v5 — 4.9b sandbox). ' +
          'The CategorizationService impl lands in sibling Task 2.',
      );
    }
    return categorization;
  }

  return {
    // ── Baseline ──────────────────────────────────────────────────────────────

    ping: pingEngine.ping.bind(pingEngine),

    async getVersion(): Promise<EngineVersion> {
      return { engine: ENGINE_VERSION, contract: CONTRACT_VERSION };
    },

    // ── Decode ────────────────────────────────────────────────────────────────

    async decode(bytes: ArrayBuffer, fileName: string): Promise<DecodeResult> {
      const jobId = generateUniqueId('job');
      return decode({
        bytes,
        fileName,
        onProgress: (done, total) => emitProgress(jobId, 'decode', done, total),
      });
    },

    // ── Import session ────────────────────────────────────────────────────────

    async importStart(rows: Record<string, unknown>[]): Promise<ImportStartResult> {
      // Registry enforces ≤1 active session BEFORE any graph is built.
      registry.assertNoActiveSession();

      const { service } = await composedPromise;

      // stage2() hydrates engine config (2.4 session-entry hydration) and runs
      // recallFor over the initial column names (2.3 recall mount) — both wired
      // through the composition root.
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
      const stage2 = entry.stage2 as ImportStatementStage2Impl;
      const col = await findColumn(stage2, sessionId, columnId);

      try {
        await parseColumnByDefinition(col, definition, params);
        entry.generatedRows = null; // column state changed — typed-row cache is stale
        entry.generatedSourceTotal = null;
        entry.lastAppliedColumnName = col.originalName.getText(); // collision key
        entry.lastAppliedColumnId = col.id; // staged-write key for resolveCollision (2.8 #4)
        const snapshot = await snapshotStage2(stage2);
        return { ok: true, snapshot };
      } catch (err) {
        if (err instanceof ColumnTransformRejection) {
          // The 2.4 gate: structured rejection DTO — the column stays UNKNOWN.
          return { ok: false, rejection: serializeColumnRejection(err) };
        }
        throw err;
      }
    },

    async importResetColumn(sessionId: string, columnId: string): Promise<Stage2SnapshotDTO> {
      const entry = registry.get(sessionId);
      // stage2.resetColumn unstages the column's staged recall write (2.8 #4):
      // a reset mapping never reaches the pool on the next advance (pin d).
      await entry.stage2.resetColumn(columnId);
      entry.generatedRows = null;
      entry.generatedSourceTotal = null;
      return snapshotStage2(entry.stage2 as unknown as ImportStatementStage2Impl);
    },

    async importConfirmRecall(sessionId: string, columnId: string): Promise<void> {
      const entry = registry.get(sessionId);
      const stage2 = entry.stage2 as ImportStatementStage2Impl;
      const col = await findColumn(stage2, sessionId, columnId);
      if (col.recallState === 'guessed') {
        // GUESSED → confirmed; applyColumn runs the learning loop (savePool).
        const confirmed = col.copy({ recallState: 'confirmed' });
        entry.stage2.applyColumn(confirmed);
      }
    },

    async importResolveCollision(sessionId: string, confirm: boolean): Promise<void> {
      const entry = registry.get(sessionId);
      const stage2 = entry.stage2 as ImportStatementStage2Impl;
      const impl = stage2 as unknown as Stage2Internal;
      const collision = impl.lastSaveCollision;
      if (!collision) {
        return; // nothing to resolve — idempotent no-op
      }
      // 2.8 decision #4 (defer-commit): writes defer to flushRecallWrites() on
      // advance, so resolve does NOT write here. On confirm, MARK the staged
      // entry confirmed → flush uses confirmSave (LWW). On decline, leave it
      // staged-unconfirmed → flush's save() returns the collision WITHOUT writing
      // (the safe no-clobber default — the stored pool entry is preserved).
      if (confirm) {
        const columnId = entry.lastAppliedColumnId;
        if (columnId) {
          stage2.confirmStagedRecallWrite(columnId);
        }
      }
      impl.lastSaveCollision = null;
    },

    async importGetRows(sessionId: string, offset: number, count: number): Promise<RowWindowDTO> {
      const entry = registry.get(sessionId);
      // Row economy (founder refinement 2): full row data flows ONLY through
      // these windows.  Generates once per column-state (cached on the entry).
      const { rows } = await generateForSession(entry);
      const total = rows.length;
      const slice = rows.slice(offset, offset + count);
      return serializeRowWindow(slice, offset, total);
    },

    async importNext(sessionId: string): Promise<ImportNextResult> {
      const entry = registry.get(sessionId);
      const stage2 = entry.stage2 as ImportStatementStage2Impl;
      const impl = stage2 as unknown as Stage2Internal;

      // Q-009 explicit stop: unmapped columns → structured DTO, session stays alive.
      const unmapped = impl.getUnmappedColumns();
      if (unmapped.length > 0) {
        return { ok: false, unmapped: serializeUnmappedColumns(unmapped) };
      }

      // 2.8 decision #4 (defer-commit): flush the STAGED recall writes on the
      // advance — the user's endorsement. One advance, one commit, one honest
      // takeover (rides the same generateForSession progress). Flush is loud-on-
      // failure but never throws, so it cannot abort the advance.
      await stage2.flushRecallWrites();

      const jobId = generateUniqueId('job');
      const result = await generateForSession(entry, (done, total) =>
        emitProgress(jobId, 'generate', done, total),
      );

      // 5.2 S3b→S3c warm: best-effort, FIRE-AND-FORGET — never blocks S3c entry. The
      // warm has the whole S3c categorization time to finish before the commit; an
      // uncached gap is caught by the commit's cache-only loud gate. Rejection
      // SWALLOWED (no unhandled-promise-rejection); offline → silently skips.
      void bulkWarmRates(result.rows.map((r) => r.date)).catch(() => {});

      // DECLARED CHANGE (2.8 decision #4 + PM clarification 2026-06-13): importNext
      // NO LONGER frees the session — S3c reuses the live session for categorize/
      // review. Only importAbort frees now (the sole free path). The ≤1-active
      // rule still holds via importStart's SessionAlreadyActiveError guard +
      // the UI's abort-before-restart (2.7 replace/remove).
      return { ok: true, result: serializeGenerateResult(result) };
    },

    async importAbort(sessionId: string): Promise<void> {
      // Free the session; no-op if already gone (idempotent)
      registry.free(sessionId);
      // v5 (4.9b): drop any open sandbox for this session — fire-and-forget so
      // importAbort resolves immediately (does NOT await composedPromise before
      // returning; guarded — categorization may be unwired until Task 2 lands).
      // v6 (4.9c): also drop any session dump (fire-and-forget, same pattern).
      void composedPromise.then(({ categorization }) => {
        categorization?.dropSandbox(sessionId);
        categorization?.dropDump(sessionId);
      });
    },

    // ── Base currency (contract v3 — Story 2.7, decision 1) ──────────────────

    async getBaseCurrency(): Promise<string | null> {
      const { settingsDao } = await composedPromise;
      if (settingsDao === null) {
        // No persistence → no base currency CAN exist. The probe's contract is
        // "null = unset" — this is genuinely unset, not an error state.
        return null;
      }
      return getBaseCurrencyOrNull(settingsDao);
    },

    async setBaseCurrency(iso: string): Promise<void> {
      // Validate FIRST — the 1.6 reference is pure, no DB needed, so an invalid
      // code reports as InvalidBaseCurrencyError even where persistence is absent.
      if (!getCurrency(iso)) {
        throw new InvalidBaseCurrencyError(iso);
      }
      const { settingsDao } = await composedPromise;
      if (settingsDao === null) {
        // A set that cannot persist must NEVER look successful (HC-7 loud).
        throw new Error(
          '[abc-engine] Cannot set base currency: persistence is unavailable ' +
            '(no indexedDB in this environment).',
        );
      }
      await setBaseCurrency(settingsDao, iso);
    },

    // ── Categorization (contract v5 — Story 4.9b sandbox; v4 added S3c, EP-4) ─
    // Task 1 (contract) delegates each method 1:1 to the composed
    // CategorizationService (the Task 1 ↔ Task 2 seam). Task 1 ships NO
    // categorization LOGIC — composeEngine resolves categorization: null until
    // sibling Task 2 wires the real impl, so these throw a loud "not implemented"
    // (HC-7) rather than silently returning empty results.

    async importCategorizedRows(
      sessionId: string,
      opts: { offset: number; count: number; segment: 'all' | 'uncat'; draft?: ConditionDTO[]; changedOnly?: boolean },
    ): Promise<CategorizedWindowDTO> {
      const svc = await resolveCategorization();
      return svc.importCategorizedRows(sessionId, opts);
    },

    async importConditionFields(sessionId: string): Promise<ConditionFieldDTO[]> {
      const svc = await resolveCategorization();
      return svc.importConditionFields(sessionId);
    },

    async importWhy(sessionId: string, rowIndex: number): Promise<WhyTreeDTO> {
      const svc = await resolveCategorization();
      return svc.importWhy(sessionId, rowIndex);
    },

    async importRulesList(sessionId: string): Promise<RuleSummaryDTO[]> {
      const svc = await resolveCategorization();
      return svc.importRulesList(sessionId);
    },

    async rulesCreate(conditions: ConditionDTO[], categoryId: string): Promise<{ ruleId: number }> {
      const svc = await resolveCategorization();
      return svc.rulesCreate(conditions, categoryId);
    },

    async categoriesList(): Promise<CategoryDTO[]> {
      const svc = await resolveCategorization();
      return svc.categoriesList();
    },

    async categoriesCreate(input: { name: string; icon: string; currency: string }): Promise<CategoryDTO> {
      const svc = await resolveCategorization();
      return svc.categoriesCreate(input);
    },

    // ── Rule editing + sandbox (contract v5 — Story 4.9b) ────────────────────

    async rulesClassify(sessionId: string, action: EditActionDTO): Promise<'live' | 'sandbox'> {
      const svc = await resolveCategorization();
      return svc.rulesClassify(sessionId, action);
    },

    async rulesSubmitEdit(sessionId: string, action: EditActionDTO): Promise<SandboxStateDTO> {
      const svc = await resolveCategorization();
      return svc.rulesSubmitEdit(sessionId, action);
    },

    async sandboxState(sessionId: string): Promise<SandboxStateDTO> {
      const svc = await resolveCategorization();
      return svc.sandboxState(sessionId);
    },

    async sandboxApply(sessionId: string): Promise<void> {
      const svc = await resolveCategorization();
      return svc.sandboxApply(sessionId);
    },

    async sandboxCancel(sessionId: string): Promise<void> {
      const svc = await resolveCategorization();
      return svc.sandboxCancel(sessionId);
    },

    // ── Auto-Other remainder + typicality (contract v6 — Story 4.9c) ─────────

    async importRemainderMagnitude(sessionId: string): Promise<RemainderMagnitudeDTO> {
      const svc = await resolveCategorization();
      return svc.importRemainderMagnitude(sessionId);
    },

    async importAssignRemainder(sessionId: string, categoryId: string | null): Promise<void> {
      const svc = await resolveCategorization();
      return svc.importAssignRemainder(sessionId, categoryId);
    },

    async importTypicality(sessionId: string, opts?: { virtual?: boolean; draft?: ConditionDTO[] }): Promise<TypicalityResultDTO> {
      const svc = await resolveCategorization();
      return svc.importTypicality(sessionId, opts);
    },

    // ── Commit (contract v7 — Story 5.1, EP-5) ───────────────────────────────

    async importCommit(sessionId: string): Promise<CommitResultDTO> {
      const svc = await resolveCategorization();
      const { rowsCommitted } = await svc.commitSession(sessionId); // throws (RatesUnavailableError) BEFORE freeing → retry-able
      // SUCCESS → free the session (raw not retained); drop any sandbox/dump (same teardown as importAbort).
      registry.free(sessionId);
      svc.dropSandbox(sessionId);
      svc.dropDump(sessionId);
      return { sessionId, rowsCommitted };
    },

    // ── Review (contract v8 — Story 5.3, EP-5 S3d) ───────────────────────────

    async importReview(sessionId: string, opts: { offset: number; count: number }): Promise<ReviewWindowDTO> {
      const svc = await resolveCategorization();
      return svc.importReview(sessionId, opts);
    },

    // ── Out-of-band events ────────────────────────────────────────────────────

    onEvent(cb: (event: EngineEventPayload) => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}
