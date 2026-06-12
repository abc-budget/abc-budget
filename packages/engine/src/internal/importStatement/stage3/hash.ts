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
 *     Type-marker landed here; dup-counter (identical full rows → suffix 0,1,2…) → EP-3.
 */

import type { ImportStatementRowData } from '../stage2/types';
import { ColumnDefinition } from '../types';

// ---------------------------------------------------------------------------
// Q-011 — pseudo-op discriminator type (Story 2.5, decision 2)
// ---------------------------------------------------------------------------

/**
 * Identifies the pseudo-op kind for the row hash discriminator.
 * 'main' = the original transaction row; 'commission' / 'cashback' = derived pseudo-ops.
 * Dup-counter (identical full rows → suffix 0,1,2…) deferred to EP-3.
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
