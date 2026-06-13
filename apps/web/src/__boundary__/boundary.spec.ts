// @vitest-environment node
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engineModule from '@abc-budget/engine';

// apps/web package root (this file is at apps/web/src/__boundary__/boundary.spec.ts)
const webRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Resolve a specifier in a fresh Node ESM process; returns stderr ('' on success). */
function resolveInNode(specifier: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`],
      { cwd: webRoot, stdio: 'pipe' },
    );
    return { ok: true, stderr: '' };
  } catch (err) {
    return { ok: false, stderr: String((err as { stderr?: Buffer | string }).stderr ?? '') };
  }
}

describe('NFR-003 UI/Engine boundary (exports map)', () => {
  it('public barrel exposes exactly the two client factories + localeToCurrency at runtime (2.7 declared change)', () => {
    // DECLARED CHANGE (2.7 decision 1): localeToCurrency joins — the pure
    // locale→ISO mapping the cold-start base-currency gate preselects with.
    expect(Object.keys(engineModule).sort()).toEqual([
      'createDirectEngineClient',
      'createWorkerEngineClient',
      'localeToCurrency',
    ]);
  });

  it('./qa subpath no longer resolves (the 2.6 sunset)', () => {
    const qa = resolveInNode('@abc-budget/engine/qa');
    expect(qa.ok).toBe(false);
    expect(qa.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('blocks deep imports into engine internals (exports map, enforced by Node/Vite)', () => {
    // package.json publishes exports for "." and "./worker" only, so the resolver
    // must refuse any deep path. Same enforcement Vite applies to production builds.
    const deep = resolveInNode('@abc-budget/engine/src/internal/ping-engine');
    expect(deep.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');

    // Teeth / self-verification: the PUBLIC entries must NOT be rejected by the exports
    // map. (They won't execute — Node can't run raw .ts — but they must get PAST the
    // exports gate, i.e. not produce ERR_PACKAGE_PATH_NOT_EXPORTED.)
    const publicEntry = resolveInNode('@abc-budget/engine');
    expect(publicEntry.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    const workerEntry = resolveInNode('@abc-budget/engine/worker');
    expect(workerEntry.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
