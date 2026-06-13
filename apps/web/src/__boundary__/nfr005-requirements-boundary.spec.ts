// @vitest-environment node
/// <reference types="node" />
/**
 * NFR-005 tripwire: the abc-budget Core repo (apps/ + packages/) must build
 * standalone without depending on the `requirements/` directory tree.
 *
 * The guard scans every .ts/.tsx source file under apps/web/src and
 * packages/ and asserts that no import path references `requirements/`.
 *
 * Scan approach: synchronous recursive directory walk reading each file's
 * text, checking for the literal string patterns:
 *   - relative path segments containing "requirements" (e.g. "../../requirements")
 *   - absolute path references containing "/requirements/"
 *
 * This is the same pattern used in the 2.6 excision spec
 * (apps/web/src/__boundary__/boundary.spec.ts) for NFR-003.
 *
 * AUTHORING ORIGIN note: the 30 help/*.md files live in
 *   requirements/deliverables/column-type-help/
 * and are VENDORED (copied) into
 *   apps/web/src/app/screens/import/s3b/help/
 * The vendored copies are the build source. `requirements/` is never imported.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Roots to scan
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
// Approximate: apps/web/src is 3 levels above __boundary__
const webSrc = fileURLToPath(new URL('..', import.meta.url));
const packagesRoot = join(repoRoot, '..', 'packages'); // <repo>/packages

function* walkTs(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist — skip silently
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      yield full;
    }
  }
}

/** Returns true if a source text contains an import/require that points into requirements/. */
function hasRequirementsImport(src: string): boolean {
  // Match: import ... from '...' or import('...') or require('...')
  // Also: import.meta.glob or fetch paths — match any string literal containing
  // "requirements" followed by "/" (relative or absolute).
  const importPattern =
    /from\s+['"]([^'"]*requirements[^'"]*)['"]/g;
  const dynamicPattern =
    /import\s*\(\s*['"]([^'"]*requirements[^'"]*)['"]\s*\)/g;
  const requirePattern =
    /require\s*\(\s*['"]([^'"]*requirements[^'"]*)['"]\s*\)/g;
  const globPattern =
    /import\.meta\.glob\s*\(\s*['"]([^'"]*requirements[^'"]*)['"]/g;

  return (
    importPattern.test(src) ||
    dynamicPattern.test(src) ||
    requirePattern.test(src) ||
    globPattern.test(src)
  );
}

describe('NFR-005: no requirements/ build dependency in apps/ or packages/', () => {
  it('apps/web/src — no .ts/.tsx file imports from requirements/', () => {
    const violations: string[] = [];
    for (const file of walkTs(webSrc)) {
      const src = readFileSync(file, 'utf-8');
      if (hasRequirementsImport(src)) {
        violations.push(relative(webSrc, file));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `NFR-005 VIOLATED: the following files in apps/web/src import from requirements/:\n` +
          violations.map((v) => `  ${v}`).join('\n') +
          '\n\nFix: vendor the files into the repo (e.g. apps/web/src/app/screens/import/s3b/help/) and import the vendored copies.',
      );
    }
    expect(violations).toHaveLength(0);
  });

  it('packages/*/src — no .ts/.tsx file imports from requirements/', () => {
    const violations: string[] = [];
    for (const file of walkTs(packagesRoot)) {
      const src = readFileSync(file, 'utf-8');
      if (hasRequirementsImport(src)) {
        violations.push(relative(packagesRoot, file));
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `NFR-005 VIOLATED: the following files in packages/ import from requirements/:\n` +
          violations.map((v) => `  ${v}`).join('\n'),
      );
    }
    expect(violations).toHaveLength(0);
  });
});
