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
  it('public barrel exposes only the client factory at runtime (no internals leak)', () => {
    expect(Object.keys(engineModule).sort()).toEqual(['createDirectEngineClient']);
  });

  it('blocks deep imports into engine internals (exports map, enforced by Node/Vite)', () => {
    // package.json publishes exports for "." only, so the resolver must refuse any deep path.
    // Same enforcement Vite applies to production builds.
    const deep = resolveInNode('@abc-budget/engine/src/internal/ping-engine');
    expect(deep.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');

    // Teeth / self-verification: the PUBLIC entry must NOT be rejected by the exports map.
    // (It won't execute — Node can't run raw .ts — but it must get PAST the exports gate,
    // i.e. it must not produce ERR_PACKAGE_PATH_NOT_EXPORTED.)
    const publicEntry = resolveInNode('@abc-budget/engine');
    expect(publicEntry.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
