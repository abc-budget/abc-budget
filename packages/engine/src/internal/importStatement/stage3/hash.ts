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
 * All other logic (HASH_COLUMN_DEFINITIONS list, generateHashableObject) is verbatim.
 */

import type { ImportStatementRowData } from '../stage2/types';
import { ColumnDefinition } from '../types';

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
 * Verbatim from prior art.
 */
export function generateHashableObject(
  row: ImportStatementRowData,
  columns: { id: string; definition: ColumnDefinition | null }[]
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

  return result;
}

/**
 * Calculates a SHA-256 hash for a row based on its column values.
 *
 * Verbatim from prior art — `@abc-budget/utils` `objectHash` replaced with the
 * inlined WebCrypto implementation above (same algorithm).
 */
export async function calculateRowHash(
  row: ImportStatementRowData,
  columns: { id: string; definition: ColumnDefinition | null }[]
): Promise<string> {
  const hashableObject = generateHashableObject(row, columns);
  return objectHash(hashableObject);
}
