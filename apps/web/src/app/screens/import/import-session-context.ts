import { createContext, useContext } from 'react';
import type { Stage2SnapshotDTO } from '@abc-budget/engine';

/**
 * The import session carried across wizard steps (2.7 → 2.8).
 *
 * Minimal by design: S3a establishes {sessionId, snapshot}; S3b (Story 2.8)
 * consumes them to drive importApplyColumn over the SAME worker-side session.
 * Both are null until S3a reaches recognized/unknown — the gate guarantees
 * S3b never mounts without them.
 */
export interface ImportSession {
  readonly sessionId: string | null;
  readonly snapshot: Stage2SnapshotDTO | null;
}

export const ImportSessionContext = createContext<ImportSession>({ sessionId: null, snapshot: null });

export function useImportSession(): ImportSession {
  return useContext(ImportSessionContext);
}
