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

    // H4: Track whether onupgradeneeded fired and how many steps completed.
    let upgradeFired = false;
    let pendingStepCount = 0;
    let completedSteps = 0;

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

    request.onsuccess = () => {
      // H4: If an upgrade ran and not all steps completed (and no known error already
      // caused an abort), reject loudly rather than silently resolving with a
      // partially-migrated database.
      if (upgradeFired && completedSteps !== pendingStepCount && migrationError === null) {
        request.result.close();
        reject(
          new Error(
            `migration sequencing invariant violated: expected ${pendingStepCount} steps, completed ${completedSteps} — database closed`,
          ),
        );
        return;
      }
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      upgradeFired = true;
      const db = request.result;
      const tx = request.transaction;
      if (!tx) {
        migrationError = new Error('version-change transaction unavailable');
        return;
      }
      const pending = steps.filter((s) => s.toVersion > event.oldVersion);
      // H4: Record how many steps are expected for this upgrade.
      pendingStepCount = pending.length;

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
          () => {
            // H4: Count this step as completed before advancing to the next.
            completedSteps++;
            runFrom(index + 1);
          },
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
