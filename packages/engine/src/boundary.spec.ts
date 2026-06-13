// @vitest-environment node
/**
 * NFR-003 engine boundary spec — the EXACT public surface, asserted.
 *
 * Story 2.6 — THE declared boundary change (the first since 1.1):
 *   - `createWorkerEngineClient` JOINS the runtime surface (the production
 *     worker transport).
 *   - `./qa` SUNSETS — the unstable decode subpath dies; decode() lives on the
 *     real EngineClient now.
 *   - `./worker` exports-map entry is the ONLY other subpath — the Vite worker
 *     entry the app spawns (`@abc-budget/engine/worker`).
 *
 * Exactness is the invariant: any future surface change must edit THIS file,
 * declaring the change.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as barrel from './index';

// engine package root (this file is at packages/engine/src/boundary.spec.ts)
const engineRoot = fileURLToPath(new URL('..', import.meta.url));

/** Resolve a specifier in a fresh Node ESM process; Node self-reference resolves
 *  `@abc-budget/engine/*` through THIS package's exports map. */
function resolveInNode(specifier: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(
      'node',
      ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`],
      { cwd: engineRoot, stdio: 'pipe' },
    );
    return { ok: true, stderr: '' };
  } catch (err) {
    return { ok: false, stderr: String((err as { stderr?: unknown }).stderr ?? '') };
  }
}

describe('NFR-003 engine boundary (declared 2.7 change: localeToCurrency joins as a pure runtime export)', () => {
  it('runtime surface is EXACTLY the two client factories + localeToCurrency', () => {
    // DECLARED CHANGE (2.7 decision 1): localeToCurrency joins the runtime
    // surface — a PURE function (no DAO, no engine state) the base-currency
    // gate uses to preselect from navigator.language.
    expect(Object.keys(barrel).sort()).toEqual([
      'createDirectEngineClient',
      'createWorkerEngineClient',
      'localeToCurrency',
    ]);
  });

  it('./qa subpath FAILS to resolve (the 2.6 sunset — exports map dropped it)', () => {
    const qa = resolveInNode('@abc-budget/engine/qa');
    expect(qa.ok).toBe(false);
    expect(qa.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('./worker subpath gets PAST the exports gate (the public worker entry)', () => {
    // It won't execute (Node can't run raw .ts) but it must not be refused by
    // the exports map — same teeth pattern as the web-side boundary spec.
    const worker = resolveInNode('@abc-budget/engine/worker');
    expect(worker.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });

  it('deep imports into internals stay blocked by the exports map', () => {
    const deep = resolveInNode('@abc-budget/engine/internal/ping-engine');
    expect(deep.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    const deepSrc = resolveInNode('@abc-budget/engine/src/internal/ping-engine');
    expect(deepSrc.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
