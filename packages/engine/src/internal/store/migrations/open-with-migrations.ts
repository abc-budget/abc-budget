/**
 * Migration-aware IndexedDB opener. Supersedes the prior-art `store/idb/database.ts`.
 * @module internal/store/migrations
 * @internal
 */
import type { MigrationStep } from './migration';
import { createMigrationContext } from './migration';

/**
 * Opens (and migrates) a database.
 *
 * Promise semantics (spec §2):
 * - Resolves ONLY after the version-change transaction has committed and the open
 *   request succeeded — never mid-upgrade, never with partially applied steps.
 * - Rejects if any step throws or any migration request fails; IndexedDB then rolls the
 *   entire version change back atomically and the database stays at its old version.
 * - Rejects on `blocked` (another connection holds an older version) — multi-tab
 *   coordination is a documented carry-forward.
 */
export function openDatabase(name: string, steps: MigrationStep[]): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      validateSteps(steps);
    } catch (err) {
      reject(err);
      return;
    }
    const targetVersion = steps[steps.length - 1].toVersion;
    let migrationError: unknown = null;
    const request = indexedDB.open(name, targetVersion);

    request.onblocked = () => {
      reject(
        new Error(
          `Database "${name}" upgrade blocked: another open connection holds an older version.`,
        ),
      );
    };

    request.onerror = () => {
      // Prefer the original step error over the generic AbortError the abort produces.
      reject(migrationError ?? request.error ?? new Error(`Failed to open database "${name}"`));
    };

    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) {
        migrationError = new Error('version-change transaction unavailable');
        return;
      }
      const pending = steps.filter((s) => s.toVersion > event.oldVersion);

      const runFrom = (index: number): void => {
        if (index >= pending.length) return; // queue drains → tx commits → onsuccess fires
        const { api, whenSettled } = createMigrationContext(db, tx);
        try {
          pending[index].migrate(api);
        } catch (err) {
          migrationError = err instanceof Error ? err : new Error(String(err));
          tx.abort();
          return;
        }
        whenSettled(
          () => runFrom(index + 1),
          (err) => {
            migrationError = err instanceof Error ? err : new Error(String(err));
            tx.abort();
          },
        );
      };

      runFrom(0);
    };
  });
}

function validateSteps(steps: MigrationStep[]): void {
  if (steps.length === 0) {
    throw new Error('openDatabase requires at least one migration step');
  }
  steps.forEach((step, i) => {
    if (step.toVersion !== i + 1) {
      throw new Error(
        `Migration steps must be contiguous from 1: expected toVersion ${i + 1}, got ${step.toVersion} at index ${i}`,
      );
    }
  });
}
