/**
 * Row hashing utility for stage 3.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/hash.ts`.
 *
 * Adaptations (diff-audit):
 *   1. `objectHash` from `@abc-budget/utils` → inline implementation using WebCrypto
 *      (same algorithm as the prior-art `webapp/libs/utils/src/lib/objects/hash.ts`).
 *      No external hash dep needed — WebCrypto is available in Node 15+ and browsers.
 *   2. Import paths updated to relative internal paths.
 *   3. verbatimModuleSyntax: `import type` for interfaces.
 *
 * The hash algorithm is:
 *   1. Recursively sort object keys → canonical JSON string.
 *   2. Encode as UTF-8.
 *   3. SHA-256 via `crypto.subtle`.
 *   4. Return hex string.
 *
 * All other logic (HASH_COLUMN_DEFINITIONS list, generateHashableObject) is verbatim,
 * except the following declared extensions:
 *   - 2.3 QA FINDING-1 (ENT-009): COUNTERPARTY added to HASH_COLUMN_DEFINITIONS.
 *   - 2.5 Q-011 (decision 2): `pseudoOp` discriminator key added to the canonical object.
 *     Type-marker landed here.
 *   - 3.2 Q-011 (second half): the dup-counter (identical full rows → distinct hashes)
 *     landed here too — `applyDupCounters`, a batch wrap→re-SHA layer over the base
 *     recipe (`finalHash = SHA-256({ base, dup })`). The base recipe below is unchanged.
 */

import type { ImportStatementRowData } from '../stage2/types';
import { ColumnDefinition } from '../types';

// ---------------------------------------------------------------------------
// Q-011 — pseudo-op discriminator type (Story 2.5, decision 2)
// ---------------------------------------------------------------------------

/**
 * Identifies the pseudo-op kind for the row hash discriminator.
 * 'main' = the original transaction row; 'commission' / 'cashback' = derived pseudo-ops.
 * The dup-counter (identical full rows → distinct hashes) is a separate wrap layer —
 * see `applyDupCounters` below (Story 3.2, Q-011 second half).
 */
export type PseudoOpKind = 'main' | 'commission' | 'cashback';

// ---------------------------------------------------------------------------
// WebCrypto objectHash (inlined from webapp/libs/utils/src/lib/objects/hash.ts)
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic hash of a JavaScript object using WebCrypto (SHA-256).
 * Verbatim port of `@abc-budget/utils` `objectHash`.
 */
async function objectHash(obj: unknown): Promise<string> {
  const canonicalJson = JSON.stringify(sortObjectKeys(obj));
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalJson);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToHex(hashBuffer);
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  const sortedObj: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sortedObj[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sortedObj;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const byteArray = new Uint8Array(buffer);
  let hexString = '';
  for (const byte of byteArray) {
    hexString += byte.toString(16).padStart(2, '0');
  }
  return hexString;
}

// ---------------------------------------------------------------------------
// Hash column definitions (verbatim from prior art)
// ---------------------------------------------------------------------------

/**
 * List of column definitions to include in the hashcode calculation.
 * These are the columns considered significant for identifying unique transactions.
 */
const HASH_COLUMN_DEFINITIONS = [
  ColumnDefinition.DATE,
  ColumnDefinition.AMOUNT,
  ColumnDefinition.DESCRIPTION,
  // EXTEND vs prior art (2.3 QA FINDING-1, ENT-009): COUNTERPARTY is identifying
  // data — hashed like description. Without it, rows differing only by
  // counterparty hash identically and silently dedup-merge once footprint
  // dedup lands (EP-3/ENT-014). Hashes are not persisted yet (HC-2/3), so
  // extending the recipe now is free.
  ColumnDefinition.COUNTERPARTY,
  ColumnDefinition.CURRENCY,
  ColumnDefinition.BALANCE,
  ColumnDefinition.BANK_ACCOUNT,
  ColumnDefinition.MERCHANT_CATEGORY,
  ColumnDefinition.EXCHANGE_RATE,
];

/**
 * Generates a hashable object from a row using specified column definitions.
 * The object uses ColumnDefinition values as keys and cell values as values.
 * If multiple columns have the same definition, their values are wrapped in a sorted array.
 *
 * 2.5 Q-011 (decision 2): `pseudoOp` discriminator key is always included so that
 * main ops, commission pseudo-ops, and cashback pseudo-ops from the SAME source row
 * produce distinct hashes. Defaults to `'main'`.
 *
 * Verbatim from prior art except: COUNTERPARTY extension (2.3) + pseudoOp key (2.5).
 */
export function generateHashableObject(
  row: ImportStatementRowData,
  columns: { id: string; definition: ColumnDefinition | null }[],
  discriminator: PseudoOpKind = 'main'
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Group columns by definition
  const columnsByDefinition: Record<string, string[]> = {};

  // Initialize with empty arrays for all hash column definitions
  HASH_COLUMN_DEFINITIONS.forEach((def) => {
    columnsByDefinition[def] = [];
  });

  // Group column IDs by their definition
  columns.forEach((column) => {
    if (
      column.definition &&
      HASH_COLUMN_DEFINITIONS.includes(column.definition)
    ) {
      columnsByDefinition[column.definition].push(column.id);
    }
  });

  // Process each definition and get values
  HASH_COLUMN_DEFINITIONS.forEach((definition) => {
    const columnIds = columnsByDefinition[definition];

    if (columnIds.length === 0) {
      result[definition] = null;
    } else if (columnIds.length === 1) {
      result[definition] = row.get(columnIds[0]).value;
    } else {
      // Multiple columns with the same definition — get values and sort
      const values = columnIds.map((id) => row.get(id).value);
      result[definition] = values.sort();
    }
  });

  // Q-011 type-marker: discriminates main ops from pseudo-ops of the same source row.
  result['pseudoOp'] = discriminator;

  return result;
}

/**
 * Calculates a SHA-256 hash for a row based on its column values.
 *
 * 2.5 Q-011 (decision 2): accepts an optional `discriminator` so that main ops,
 * commission pseudo-ops, and cashback pseudo-ops from the same source row yield
 * pairwise-distinct hashes. Defaults to `'main'` — existing callers are untouched.
 *
 * Verbatim from prior art — `@abc-budget/utils` `objectHash` replaced with the
 * inlined WebCrypto implementation above (same algorithm).
 */
export async function calculateRowHash(
  row: ImportStatementRowData,
  columns: { id: string; definition: ColumnDefinition | null }[],
  discriminator: PseudoOpKind = 'main'
): Promise<string> {
  const hashableObject = generateHashableObject(row, columns, discriminator);
  return objectHash(hashableObject);
}

// ---------------------------------------------------------------------------
// Q-011 second half — dup-counter (Story 3.2, decisions 1–6)
// ---------------------------------------------------------------------------

/**
 * Batch dup-counter post-pass: given the BASE hashes of every generated row in
 * a single import batch (in order), return the FINAL hashes that give genuine
 * full-row duplicates distinct identities.
 *
 * Two rows identical across all 9 recipe fields AND the same `pseudoOp` produce
 * the same base hash. Grouping the batch by base hash and assigning a counter
 * `0..n-1` per group, then wrapping each as `objectHash({ base, dup })`, yields
 * a distinct final hash per occurrence — `{h#0, h#1, …}` (Q-011 second half).
 *
 * Decision 6 — wrap → re-SHA: the final hash stays a uniform opaque 64-hex SHA
 * (no parseable `base#k` structure); the base recipe (`generateHashableObject`)
 * is byte-UNCHANGED — `dup` is a separate layer, not a recipe field.
 *
 * Decision 1 — BATCH-deterministic, never against the store: the counter is a
 * pure function of THIS batch's base hashes; the same statement always yields
 * the same SET, so 3.4's upsert is idempotent (a re-import never sees N and
 * assigns N..2N-1).
 *
 * Decision 2/3 — stable by COUNT, not order; no inter-row links: `k` is assigned
 * in index order, but because grouped rows are identical the resulting SET of
 * final hashes is invariant under input reordering (HC-9). Per-index assignment
 * may differ across orders; the multiset/SET does not.
 *
 * @param baseHashes  The per-row base hashes (`calculateRowHash` output), in row order.
 * @returns           The final hashes, aligned 1:1 to `baseHashes` by index.
 */
export async function applyDupCounters(
  baseHashes: readonly string[]
): Promise<string[]> {
  const seen = new Map<string, number>(); // base hash → next counter for that group
  const finals: string[] = [];
  for (const base of baseHashes) {
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    finals.push(await objectHash({ base, dup }));
  }
  return finals;
}
