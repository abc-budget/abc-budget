/**
 * Recall pool spec — TDD red phase.
 *
 * Contract: §2 of 2026-06-11-story-2.3-recall-pool-design.md
 * Locked decisions: §LD-1 (collision kinds), §LD-2 (NFC+trim key, stored normalized).
 *
 * Test vector for NFD pin:
 *   'Дата і час' with the Ukrainian 'і' (U+0456 CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I)
 *   NFD-encoded becomes a two-code-point sequence. We build the NFD form explicitly via .normalize('NFD').
 *   The padded variant '  Сума  ' trims to 'Сума'.
 *
 * No Date.now / Math.random anywhere — LWW is structural (confirmSave overwrites).
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MigrationStep } from '../../store/migrations/migration';
import { openDatabase } from '../../store/migrations/open-with-migrations';
import { ColumnDefinition } from '../types';
import type { AmountColumnParams, DateColumnParams } from '../types';
import type { RecallPool } from './recall';
import { normalizeKey, createRecallPool } from './recall';
import { getEngineConfig } from '../../settings/engine-config';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Opens a test DB with just the recallPool store (mirrors migration v3 recallPool step). */
function openTestDb(name: string): Promise<IDBDatabase> {
  const step: MigrationStep = {
    toVersion: 1,
    migrate: (ctx) => ctx.createStore('recallPool', { keyPath: 'columnName' }),
  };
  return openDatabase(name, [step]);
}

let db: IDBDatabase;
let pool: RecallPool;
let dbName: string;

beforeEach(async () => {
  dbName = `recall-test-${Math.random().toString(36).slice(2)}`;
  db = await openTestDb(dbName);
  pool = createRecallPool(() => db);
});

afterEach(async () => {
  if (db) db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

// ── normalizeKey ─────────────────────────────────────────────────────────────

describe('normalizeKey', () => {
  it('trims whitespace', () => {
    expect(normalizeKey('  Сума  ')).toBe('Сума');
  });

  it('converts NFD to NFC', () => {
    const nfd = 'Дата і час'.normalize('NFD');
    const nfc = 'Дата і час'.normalize('NFC');
    expect(normalizeKey(nfd)).toBe(nfc);
  });

  it('preserves case and internal whitespace', () => {
    expect(normalizeKey('Дата і час')).toBe('Дата і час');
  });

  it('normalizes a plain ASCII name', () => {
    expect(normalizeKey('  Amount  ')).toBe('Amount');
  });

  it('normalizes col_N keys like any other name', () => {
    expect(normalizeKey('  col_3  ')).toBe('col_3');
  });
});

// ── normalize-before-save pin (LD-2 founder refinement) ──────────────────────

describe('normalize-before-save pin (LD-2)', () => {
  /**
   * NFD test vector:
   *   'Дата і час' — Ukrainian phrase. 'і' = U+0456 (CYRILLIC SMALL LETTER
   *   BYELORUSSIAN-UKRAINIAN I). NFD form decomposes combining marks if any.
   *   We call .normalize('NFD') on the entire string to simulate an xlsx
   *   extractor emitting NFD-encoded names.
   *
   * Padded vector: '  Сума  ' — has leading+trailing spaces.
   *
   * Both must be stored under their NFC+trim key; lookups by ALL variants hit
   * the same single entry.
   */

  const nfdName = 'Дата і час'.normalize('NFD');
  const nfcName = 'Дата і час'.normalize('NFC');
  const paddedName = '  Сума  ';
  const trimmedName = 'Сума';

  const dateDefinition = ColumnDefinition.DATE;
  const dateParams: DateColumnParams = { format: 'auto' };
  const amountDefinition = ColumnDefinition.AMOUNT;

  it('saves NFD-encoded name — stored key is NFC form', async () => {
    const result = await pool.save(nfdName, dateDefinition, dateParams);
    expect(result.outcome).toBe('saved');

    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(nfcName);
  });

  it('saves padded name — stored key is trimmed form', async () => {
    const result = await pool.save(paddedName, amountDefinition, null);
    expect(result.outcome).toBe('saved');

    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(trimmedName);
  });

  it('saves NFD + padded names → exactly two entries, each keyed normalized', async () => {
    await pool.save(nfdName, dateDefinition, dateParams);
    await pool.save(paddedName, amountDefinition, null);

    const keys = (await pool.getAllKeys()).sort();
    expect(keys).toHaveLength(2);
    expect(keys).toContain(nfcName);
    expect(keys).toContain(trimmedName);
  });

  it('lookup by NFD variant hits the saved NFC entry', async () => {
    // Save under NFC form
    await pool.save(nfcName, dateDefinition, dateParams);
    // Look up with NFD form — recallFor normalizes the input → finds NFC entry
    const recall = await pool.recallFor([nfdName]);
    // Exactly one prefill found; map key is the normalized (NFC) form
    expect(recall.prefills.size).toBe(1);
    // The map key returned is the normalized form (NFC)
    const [[key]] = recall.prefills.entries();
    expect(key).toBe(nfcName);
    // And the prefill entry is accessible via the NFC key
    expect(recall.prefills.has(nfcName)).toBe(true);
  });

  it('lookup by padded variant hits the saved trimmed entry', async () => {
    await pool.save(trimmedName, amountDefinition, null);
    const recall = await pool.recallFor([paddedName]);
    expect(recall.prefills.size).toBe(1);
    const [[key]] = recall.prefills.entries();
    expect(key).toBe(trimmedName);
  });

  it('lookup by exact NFC variant also hits', async () => {
    await pool.save(nfcName, dateDefinition, dateParams);
    const recall = await pool.recallFor([nfcName]);
    expect(recall.prefills.size).toBe(1);
    const [[key]] = recall.prefills.entries();
    expect(key).toBe(nfcName);
  });

  it('saving NFD then saving same name NFC is a no-op (identical mapping)', async () => {
    await pool.save(nfdName, dateDefinition, dateParams);
    const result = await pool.save(nfcName, dateDefinition, dateParams);
    expect(result.outcome).toBe('saved'); // no-op, not collision

    // Still only one entry
    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(1);
  });
});

// ── save semantics ────────────────────────────────────────────────────────────

describe('save semantics', () => {
  const dateParams: DateColumnParams = { format: 'auto' };

  it('new name → saved', async () => {
    const result = await pool.save('Amount', ColumnDefinition.AMOUNT, null);
    expect(result.outcome).toBe('saved');
  });

  it('identical mapping (same definition + same params) → no-op saved', async () => {
    await pool.save('Date', ColumnDefinition.DATE, dateParams);
    const result = await pool.save('Date', ColumnDefinition.DATE, dateParams);
    expect(result.outcome).toBe('saved');

    // Still one entry
    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(1);
  });

  it('identical mapping with null params on both sides → no-op saved', async () => {
    await pool.save('Amount', ColumnDefinition.AMOUNT, null);
    const result = await pool.save('Amount', ColumnDefinition.AMOUNT, null);
    expect(result.outcome).toBe('saved');
  });

  it('semantically identical params with different key order → no-op saved, NOT a phantom collision (QA FINDING-2)', async () => {
    // Same data, different key insertion order — JSON.stringify would differ,
    // but paramsEqual must be key-order-insensitive.
    const paramsAB = { currency: 'auto', type: 'outcome' } as unknown as AmountColumnParams;
    const paramsBA = { type: 'outcome', currency: 'auto' } as unknown as AmountColumnParams;

    await pool.save('Amount', ColumnDefinition.AMOUNT, paramsAB);
    const result = await pool.save('Amount', ColumnDefinition.AMOUNT, paramsBA);

    expect(result.outcome).toBe('saved');
    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(1);
  });

  it('same definition + different params → params-change collision', async () => {
    const originalParams: DateColumnParams = { format: 'auto' };
    const newParams: DateColumnParams = { format: { custom: 'dd/MM/yyyy' } };

    await pool.save('Date', ColumnDefinition.DATE, originalParams);
    const result = await pool.save('Date', ColumnDefinition.DATE, newParams);

    expect(result.outcome).toBe('collision');
    if (result.outcome === 'collision') {
      expect(result.collision.kind).toBe('params-change');
      expect(result.collision.existing.definition).toBe(ColumnDefinition.DATE);
      expect(result.collision.existing.params).toEqual(originalParams);
      expect(result.collision.incoming.definition).toBe(ColumnDefinition.DATE);
      expect(result.collision.incoming.params).toEqual(newParams);
    }
  });

  it('same definition + params null → non-null → params-change collision', async () => {
    await pool.save('Amount', ColumnDefinition.AMOUNT, null);
    const result = await pool.save('Amount', ColumnDefinition.AMOUNT, { currency: 'auto' });

    expect(result.outcome).toBe('collision');
    if (result.outcome === 'collision') {
      expect(result.collision.kind).toBe('params-change');
    }
  });

  it('different definition → type-change collision', async () => {
    await pool.save('Col', ColumnDefinition.DATE, dateParams);
    const result = await pool.save('Col', ColumnDefinition.AMOUNT, null);

    expect(result.outcome).toBe('collision');
    if (result.outcome === 'collision') {
      expect(result.collision.kind).toBe('type-change');
      expect(result.collision.existing.definition).toBe(ColumnDefinition.DATE);
      expect(result.collision.incoming.definition).toBe(ColumnDefinition.AMOUNT);
    }
  });

  it('confirmSave (LWW) overwrites entry with incoming', async () => {
    const originalParams: DateColumnParams = { format: 'auto' };
    const newParams: DateColumnParams = { format: { custom: 'dd/MM/yyyy' } };

    await pool.save('Date', ColumnDefinition.DATE, originalParams);
    const collision = await pool.save('Date', ColumnDefinition.DATE, newParams);
    expect(collision.outcome).toBe('collision');

    // Confirm the overwrite
    await pool.confirmSave('Date', ColumnDefinition.DATE, newParams);

    // Now no-op save with new params should return 'saved' (no more collision)
    const afterConfirm = await pool.save('Date', ColumnDefinition.DATE, newParams);
    expect(afterConfirm.outcome).toBe('saved');

    // And entry holds the incoming params
    const recall = await pool.recallFor(['Date']);
    const entry = recall.prefills.get('Date');
    expect(entry).toBeDefined();
    expect(entry!.params).toEqual(newParams);
  });

  it('confirmSave type-change → entry updated', async () => {
    await pool.save('Col', ColumnDefinition.DATE, dateParams);
    await pool.confirmSave('Col', ColumnDefinition.AMOUNT, null);

    const recall = await pool.recallFor(['Col']);
    const entry = recall.prefills.get('Col');
    expect(entry!.definition).toBe(ColumnDefinition.AMOUNT);
    expect(entry!.params).toBeNull();
  });
});

// ── detectCollision (2.8 decision #4 — read-only DETECT, no write) ────────────

describe('detectCollision — read-only collision detect (2.8 defer-commit)', () => {
  const dateParams: DateColumnParams = { format: 'auto' };

  it('new name → saved outcome, but writes NOTHING (pool stays empty)', async () => {
    const result = await pool.detectCollision('Amount', ColumnDefinition.AMOUNT, null);
    expect(result.outcome).toBe('saved');
    // The defining contract: detect MUST NOT write.
    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(0);
  });

  it('identical mapping → saved outcome, no write', async () => {
    await pool.save('Date', ColumnDefinition.DATE, dateParams);
    const result = await pool.detectCollision('Date', ColumnDefinition.DATE, dateParams);
    expect(result.outcome).toBe('saved');
    const keys = await pool.getAllKeys();
    expect(keys).toHaveLength(1); // unchanged — detect did not add/overwrite
  });

  it('same definition + different params → params-change collision, no write', async () => {
    const originalParams: DateColumnParams = { format: 'auto' };
    const newParams: DateColumnParams = { format: { custom: 'dd/MM/yyyy' } };
    await pool.save('Date', ColumnDefinition.DATE, originalParams);

    const result = await pool.detectCollision('Date', ColumnDefinition.DATE, newParams);
    expect(result.outcome).toBe('collision');
    if (result.outcome === 'collision') {
      expect(result.collision.kind).toBe('params-change');
      expect(result.collision.existing.params).toEqual(originalParams);
      expect(result.collision.incoming.params).toEqual(newParams);
    }

    // The stored entry is UNTOUCHED — detect left the original params in place.
    const recall = await pool.recallFor(['Date']);
    expect(recall.prefills.get('Date')!.params).toEqual(originalParams);
  });

  it('different definition → type-change collision, no write', async () => {
    await pool.save('Col', ColumnDefinition.DATE, dateParams);
    const result = await pool.detectCollision('Col', ColumnDefinition.AMOUNT, null);
    expect(result.outcome).toBe('collision');
    if (result.outcome === 'collision') {
      expect(result.collision.kind).toBe('type-change');
    }
    // Stored entry stays DATE — detect wrote nothing.
    const recall = await pool.recallFor(['Col']);
    expect(recall.prefills.get('Col')!.definition).toBe(ColumnDefinition.DATE);
  });

  it('normalizes the name before detect (NFD variant hits the saved NFC entry)', async () => {
    await pool.save('Дата і час', ColumnDefinition.DATE, dateParams);
    const nfd = 'Дата і час'.normalize('NFD');
    // Same mapping under the NFD form → identical (saved), no collision.
    const result = await pool.detectCollision(nfd, ColumnDefinition.DATE, dateParams);
    expect(result.outcome).toBe('saved');
  });

  it('detect → save parity: detect returns the SAME outcome save would, without writing', async () => {
    await pool.save('Col', ColumnDefinition.DATE, dateParams);
    const detected = await pool.detectCollision('Col', ColumnDefinition.AMOUNT, null);
    // detect did not write; a subsequent save sees the same prior state and agrees.
    const saved = await pool.save('Col', ColumnDefinition.AMOUNT, null);
    expect(detected.outcome).toBe(saved.outcome); // both 'collision'
  });
});

// ── recallFor ────────────────────────────────────────────────────────────────

describe('recallFor', () => {
  it('empty pool → n=0, m=names.length, no prefills', async () => {
    const result = await pool.recallFor(['Date', 'Amount', 'Description']);
    expect(result.prefills.size).toBe(0);
    expect(result.recognized.n).toBe(0);
    expect(result.recognized.m).toBe(3);
  });

  it('unknown names → absent from prefills (stay UNKNOWN)', async () => {
    await pool.save('Date', ColumnDefinition.DATE, { format: 'auto' });
    const result = await pool.recallFor(['Date', 'UnknownColumn']);

    expect(result.prefills.has('Date')).toBe(true);
    expect(result.prefills.has('UnknownColumn')).toBe(false);
  });

  it('known names → prefill entries with state: "guessed"', async () => {
    await pool.save('Date', ColumnDefinition.DATE, { format: 'auto' });
    const result = await pool.recallFor(['Date']);

    const entry = result.prefills.get('Date');
    expect(entry).toBeDefined();
    expect(entry!.definition).toBe(ColumnDefinition.DATE);
    expect(entry!.params).toEqual({ format: 'auto' });
    expect(entry!.state).toBe('guessed');
  });

  it('recognized: { n, m } derived correctly', async () => {
    await pool.save('Date', ColumnDefinition.DATE, { format: 'auto' });
    await pool.save('Amount', ColumnDefinition.AMOUNT, null);

    const result = await pool.recallFor(['Date', 'Amount', 'Unknown']);
    expect(result.recognized.n).toBe(2);
    expect(result.recognized.m).toBe(3);
  });

  it('col_N keys work like any other name', async () => {
    await pool.save('col_0', ColumnDefinition.DATE, { format: 'auto' });
    await pool.save('col_1', ColumnDefinition.AMOUNT, null);

    const result = await pool.recallFor(['col_0', 'col_1', 'col_2']);
    expect(result.recognized.n).toBe(2);
    expect(result.recognized.m).toBe(3);
    expect(result.prefills.get('col_0')!.state).toBe('guessed');
    expect(result.prefills.get('col_1')!.state).toBe('guessed');
    expect(result.prefills.has('col_2')).toBe(false);
  });
});

// ── persistence across close/reopen ──────────────────────────────────────────

describe('persistence across close/reopen', () => {
  it('pool survives close + reopen of the test DB', async () => {
    // Save entries
    await pool.save('Date', ColumnDefinition.DATE, { format: 'auto' });
    await pool.save('Amount', ColumnDefinition.AMOUNT, null);

    // Close DB
    db.close();

    // Reopen same DB
    db = await openTestDb(dbName);
    const pool2 = createRecallPool(() => db);

    const result = await pool2.recallFor(['Date', 'Amount']);
    expect(result.recognized.n).toBe(2);
    expect(result.recognized.m).toBe(2);
    expect(result.prefills.get('Date')!.definition).toBe(ColumnDefinition.DATE);
    expect(result.prefills.get('Amount')!.definition).toBe(ColumnDefinition.AMOUNT);
  });
});

// ── auto-detect flag ──────────────────────────────────────────────────────────

describe('auto-detect flag (recallAutoDetectEnabled in engine-config)', () => {
  it('default engine config has recallAutoDetectEnabled: false', () => {
    const config = getEngineConfig();
    expect(config.recallAutoDetectEnabled).toBe(false);
  });

  it('when OFF (default): unknown names are untouched (absent from prefills)', async () => {
    // Pool is empty; recallFor with autoDetect=false (default)
    // Provide sample values that look like dates — they must NOT be auto-detected
    const result = await pool.recallFor(
      ['Дата', 'Сума'],
      {
        sampleValues: {
          'Дата': ['01.01.2024', '02.01.2024', '03.01.2024'],
          'Сума': ['100', '200', '-50'],
        },
        autoDetect: false,
      }
    );

    expect(result.prefills.size).toBe(0);
    expect(result.recognized.n).toBe(0);
  });

  it('when ON: date column heuristic via detectDateFormat → GUESSED prefill with DateColumnParams', async () => {
    // date-like sample values — enough to pass detectDateFormat threshold
    // We use dd.MM.yyyy format (100 values to pass the min-sample-size threshold)
    const dateValues: string[] = [];
    for (let d = 1; d <= 28; d++) {
      for (let rep = 0; rep < 4; rep++) {
        dateValues.push(`${String(d).padStart(2, '0')}.01.2024`);
      }
    }
    // 112 values — passes minSampleSize=100

    const result = await pool.recallFor(
      ['Дата', 'Сума'],
      {
        sampleValues: {
          'Дата': dateValues,
          'Сума': ['100', '200', '-50'],
        },
        autoDetect: true,
      }
    );

    // 'Дата' should be auto-detected as a date column
    const dateEntry = result.prefills.get('Дата');
    expect(dateEntry).toBeDefined();
    expect(dateEntry!.definition).toBe(ColumnDefinition.DATE);
    expect(dateEntry!.state).toBe('guessed');
    expect(dateEntry!.params).not.toBeNull();

    // 'Сума' — numbers don't match date or status pattern deterministically
    // may or may not be detected; but it's NOT a date column
    if (result.prefills.has('Сума')) {
      expect(result.prefills.get('Сума')!.definition).not.toBe(ColumnDefinition.DATE);
    }
  });

  it('when ON: status-pattern heuristic detects a column with few distinct dominant values → GUESSED STATUS', async () => {
    // A status column: distinct values ⊆ small set, one dominant
    // e.g. 80%+ 'OK', rest 'Failed'
    const statusValues: string[] = [];
    for (let i = 0; i < 90; i++) statusValues.push('OK');
    for (let i = 0; i < 10; i++) statusValues.push('Failed');
    // 100 values total

    const result = await pool.recallFor(
      ['Status'],
      {
        sampleValues: {
          'Status': statusValues,
        },
        autoDetect: true,
      }
    );

    const statusEntry = result.prefills.get('Status');
    expect(statusEntry).toBeDefined();
    expect(statusEntry!.definition).toBe(ColumnDefinition.STATUS);
    expect(statusEntry!.state).toBe('guessed');
  });

  it('when ON: results carry state: "guessed" (never confirmed)', async () => {
    const dateValues: string[] = [];
    for (let d = 1; d <= 28; d++) {
      for (let rep = 0; rep < 4; rep++) {
        dateValues.push(`${String(d).padStart(2, '0')}.01.2024`);
      }
    }

    const result = await pool.recallFor(
      ['MyDate'],
      {
        sampleValues: { 'MyDate': dateValues },
        autoDetect: true,
      }
    );

    if (result.prefills.has('MyDate')) {
      expect(result.prefills.get('MyDate')!.state).toBe('guessed');
    }
  });
});
