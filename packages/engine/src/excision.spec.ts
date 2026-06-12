/**
 * excision.spec.ts — FileFormat/FileSource excision tripwire (Story 2.6, decision 3).
 *
 * Discipline 2 (grep-proven): ZERO `FileFormat` / `FileSource` identifiers may
 * survive in engine source CODE.  The format entity is abolished (FEAT-005
 * «no format entity», FEAT-011 revised); format-level recall is superseded by
 * the 2.3 columnName recall pool.  This spec is a standing tripwire — like the
 * boundary spec, it turns the excision from a one-off review into a
 * regression-proof invariant.
 *
 * Approach (kept deliberately simple):
 *   1. Recursively walk `packages/engine/src` (this file's directory).
 *   2. Take every `.ts` file EXCEPT `*.spec.ts` (test files may mention the
 *      names in EXCISED callout comments and local fixture types; the
 *      discipline targets production source).
 *   3. Strip comments — block (slash-star … star-slash) and line (`// …`) —
 *      with regexes.
 *      Known limitation, accepted for a tripwire: a `//` inside a string
 *      literal (e.g. a URL) truncates that line from the scan, which can only
 *      under-match, never false-positive.
 *   4. Assert the remaining CODE matches /FileFormat|FileSource/i nowhere
 *      (case-insensitive — catches `fileFormatDAO`, `fileSources`, store-name
 *      strings, etc.).  Failures report file + line for fast triage.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = dirname(fileURLToPath(import.meta.url));

/** Recursively collect all .ts files under dir, excluding *.spec.ts. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block and line comments. Simple by design (see header note 3). */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '');
}

const FORBIDDEN = /fileformat|filesource/i;

describe('FileFormat/FileSource excision tripwire (2.6 decision 3, grep-proven)', () => {
  it('scans a non-trivial source tree (sanity: the walker actually finds files)', () => {
    const files = collectSourceFiles(SRC_ROOT);
    // The engine src tree is large; a low bound guards against a silently
    // broken walker making the main assertion vacuous.
    expect(files.length).toBeGreaterThan(30);
  });

  it('no FileFormat/FileSource identifier survives in engine source code (outside comments)', () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(SRC_ROOT)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!FORBIDDEN.test(code)) continue;

      // Report per-line for fast triage (line numbers are post-strip — the
      // strip preserves newlines for line comments but not block comments;
      // the file path is the load-bearing part).
      code.split(/\r?\n/).forEach((line, i) => {
        if (FORBIDDEN.test(line)) {
          offenders.push(`${relative(SRC_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, `FileFormat/FileSource residue found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
