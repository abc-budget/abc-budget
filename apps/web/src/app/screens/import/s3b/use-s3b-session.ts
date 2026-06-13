import { useCallback, useRef, useState } from 'react';
import type {
  ColumnRejectionDTO,
  CollisionDTO,
  EngineClient,
  ImportNextResult,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { buildEngineParams, paramDefaults } from './param-schema';
import { columnState } from './types';
import type { ColumnState } from './types';

/**
 * use-s3b-session (Story 2.8, Task 4) — the S3b state machine over the
 * EngineClient seam.
 *
 * SEEDING: the hook is seeded from ImportSessionContext's {sessionId, snapshot}
 * (passed as args). It holds the LATEST Stage2SnapshotDTO locally; every
 * apply/reset/resolveCollision returns a fresh snapshot that replaces it.
 *
 * RE-SEED RULE (back-nav semantics, item 2): the local snapshot is re-seeded
 * from the arg ONLY when the sessionId changes — i.e. S3a replaced the file
 * (importAbort → new importStart → new sessionId), so S3b must start
 * all-UNKNOWN.  A same-sessionId re-render (S3b → «Назад» → S3a → forward → S3b)
 * keeps the live snapshot, so applied columns survive.  The session + staged
 * mappings live on the worker-side session; nothing is re-fetched.
 *
 * confirmRecall OPTIMISTIC UPDATE (verified engine contract): the engine's
 * importConfirmRecall returns void (NOT a snapshot) — the recallState
 * guessed→confirmed flip would otherwise only surface on the next
 * snapshot-returning op.  Per the Task-4 brief decision (b) we apply an
 * OPTIMISTIC local update (flip recallState to 'confirmed' on the column) for
 * responsive UX; it reconciles to the engine's truth on the next real snapshot
 * (apply/reset/resolveCollision).  No engine wire change (role fence).
 */

/** A rejection bound to the column that produced it (RejectionPanel state). */
export interface ActiveRejection {
  readonly columnId: string;
  readonly rejection: ColumnRejectionDTO;
}

export interface S3bSession {
  /** The latest Stage2 snapshot (local source of truth). */
  snapshot: Stage2SnapshotDTO;
  /** Ids of still-UNKNOWN columns (= snapshot.unmapped) — the gate list. */
  unmappedIds: string[];
  /** {n, m} recognized counts off the snapshot. */
  recognized: { n: number; m: number };
  /** The pending save collision (loud, non-blocking), or null. */
  lastSaveCollision: CollisionDTO | null;
  /**
   * The id of the column the active collision is bound to, or null.
   *
   * CollisionDTO carries no columnId (decision #5 surfaces it per-column in the
   * UI but the wire only sends the descriptor).  We bind it to the column whose
   * apply/confirm RAISED the collision — the last apply/confirm whose returned
   * snapshot had a non-null lastSaveCollision.  Cleared together with the
   * collision (resolveCollision, or any snapshot that clears the flag).
   */
  collisionColumnId: string | null;
  /** The active >30% rejection (column stays UNKNOWN), or null. */
  rejection: ActiveRejection | null;
  /** Derived display state for a column id. */
  stateOf: (columnId: string) => ColumnState;

  /** Apply a definition with explicit UI values → buildEngineParams → engine. */
  apply: (columnId: string, definition: string, uiValues: Record<string, string>) => Promise<void>;
  /** Instant apply with the type's default params. */
  applyInstant: (columnId: string, definition: string) => Promise<void>;
  /** Reset a column to UNKNOWN (engine unstages too). */
  reset: (columnId: string) => Promise<void>;
  /** Confirm a recalled (guessed) column → clears the ◇ flag (optimistic). */
  confirmRecall: (columnId: string) => Promise<void>;
  /** Resolve the save collision (true = LWW overwrite, false = keep stored). */
  resolveCollision: (confirm: boolean) => Promise<void>;
  /** Advance — flushes staged recall + generates rows (large-file progress). */
  next: () => Promise<ImportNextResult>;
}

export function useS3bSession(
  client: EngineClient,
  sessionId: string,
  initialSnapshot: Stage2SnapshotDTO,
): S3bSession {
  const [snapshot, setSnapshot] = useState<Stage2SnapshotDTO>(initialSnapshot);
  const [rejection, setRejection] = useState<ActiveRejection | null>(null);
  /** The column the active collision belongs to (CollisionDTO has no id). */
  const [collisionColumnId, setCollisionColumnId] = useState<string | null>(null);

  /** Re-seed only when the sessionId changes (a new S3a session). */
  const seededSessionRef = useRef(sessionId);
  if (seededSessionRef.current !== sessionId) {
    // Render-time re-seed on session swap (S3a replaced the file): the
    // setState-during-render pattern is valid here — it re-renders synchronously
    // with the fresh snapshot before paint, no effect/flash.
    seededSessionRef.current = sessionId;
    if (snapshot !== initialSnapshot) setSnapshot(initialSnapshot);
    if (rejection !== null) setRejection(null);
    if (collisionColumnId !== null) setCollisionColumnId(null);
  }

  const apply = useCallback(
    async (columnId: string, definition: string, uiValues: Record<string, string>) => {
      const params = buildEngineParams(definition, uiValues);
      const res = await client.importApplyColumn(sessionId, columnId, definition, params);
      if (res.ok) {
        setSnapshot(res.snapshot);
        setRejection(null);
        // Bind a freshly-raised collision to this column; clear it otherwise so
        // a clean apply on a different column doesn't keep a stale binding.
        setCollisionColumnId(res.snapshot.lastSaveCollision !== null ? columnId : null);
      } else {
        // Column stays UNKNOWN (snapshot unchanged); surface the rejection.
        setRejection({ columnId, rejection: res.rejection });
      }
    },
    [client, sessionId],
  );

  const applyInstant = useCallback(
    (columnId: string, definition: string) => apply(columnId, definition, paramDefaults(definition)),
    [apply],
  );

  const reset = useCallback(
    async (columnId: string) => {
      const next = await client.importResetColumn(sessionId, columnId);
      setSnapshot(next);
      setRejection((r) => (r?.columnId === columnId ? null : r));
      // Resetting the colliding column unstages it → the collision is moot.
      setCollisionColumnId((cur) => (cur === columnId || next.lastSaveCollision === null ? null : cur));
    },
    [client, sessionId],
  );

  const confirmRecall = useCallback(
    async (columnId: string) => {
      await client.importConfirmRecall(sessionId, columnId);
      // OPTIMISTIC: the engine returns void; flip the column's recallState
      // locally so the ◇ clears now. Reconciled on the next real snapshot.
      setSnapshot((prev) => ({
        ...prev,
        columns: prev.columns.map((c) =>
          c.id === columnId && c.recallState === 'guessed' ? { ...c, recallState: 'confirmed' } : c,
        ),
      }));
    },
    [client, sessionId],
  );

  const resolveCollision = useCallback(
    async (confirm: boolean) => {
      await client.importResolveCollision(sessionId, confirm);
      // importResolveCollision returns void; the collision flag lives on the
      // snapshot. Optimistically clear it locally (reconciled on next snapshot).
      // confirm=true → LWW overwrite at flush; confirm=false → keep stored entry
      // (no-clobber, proven at the Task-1 engine round-trip). Either way the loud
      // UI affordance is dismissed: the user has answered.
      setSnapshot((prev) => (prev.lastSaveCollision === null ? prev : { ...prev, lastSaveCollision: null }));
      setCollisionColumnId(null);
    },
    [client, sessionId],
  );

  const next = useCallback(() => client.importNext(sessionId), [client, sessionId]);

  const stateOf = useCallback(
    (columnId: string): ColumnState => {
      const c = snapshot.columns.find((col) => col.id === columnId);
      if (!c) return 'unknown';
      return columnState({ definition: c.definition, recallState: c.recallState });
    },
    [snapshot],
  );

  return {
    snapshot,
    unmappedIds: snapshot.unmapped.map((u) => u.id),
    recognized: snapshot.recognized,
    lastSaveCollision: snapshot.lastSaveCollision,
    collisionColumnId: snapshot.lastSaveCollision === null ? null : collisionColumnId,
    rejection,
    stateOf,
    apply,
    applyInstant,
    reset,
    confirmRecall,
    resolveCollision,
    next,
  };
}
