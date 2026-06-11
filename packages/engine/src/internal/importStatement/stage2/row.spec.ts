/**
 * PORT of `webapp/libs/engine/src/importStatement/stage2/row.spec.ts`.
 *
 * Mechanical adaptation (diff-audit):
 *   1. Imports: `@abc-budget/utils` → local utils/messages; all changed to relative.
 *   2. `jest.fn()` / `jest.Mocked<>` removed — not used in row.spec.ts.
 *   3. `import { vi, describe, it, expect, beforeEach } from 'vitest'` added.
 *   4. `makeColumn` helper unchanged — constructs real ImportStatementColumn directly
 *      (same as prior art — no Container injection in this spec).
 *   5. CurrencyCache constructor arg removed (7th arg was null in prior art anyway;
 *      now the constructor accepts only 6 args in the 1.6 port).
 *   6. All assertions kept verbatim.
 *
 * Async-ripple: row.spec.ts has no async operations — no signature changes needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NativeMessage } from '../../utils/messages/message';
import { ImportStatementColumn } from './column';
import { ImportStatementRow } from './row';
import type { CellData } from './types';
import { SupportedDataType } from './types';

// Helper to create a fake ImportStatementColumn-like object with data
function makeColumn(
  id: string,
  name: string,
  rows: Partial<CellData>[]
): ImportStatementColumn {
  // We construct a real ImportStatementColumn to stay close to runtime shape
  // but we don't need stage association or definitions here.
  const nameMsg = new NativeMessage(name);
  const col = new ImportStatementColumn(
    id,
    nameMsg,
    nameMsg,
    null,
    null,
    rows.map(
      (r): CellData => ({
        value: r.value ?? null,
        type: (r.type ?? SupportedDataType.TEXT) as SupportedDataType,
        error: r.error ?? undefined,
        ignore: r.ignore ?? undefined,
      })
    )
    // No 7th arg — 1.6 wiring: CurrencyCache removed from constructor
  );
  return col;
}

describe('ImportStatementRow', () => {
  let col1: ImportStatementColumn;
  let col2: ImportStatementColumn;
  let col3: ImportStatementColumn;
  let columns: ImportStatementColumn[];

  beforeEach(() => {
    col1 = makeColumn('col1', 'Column 1', [
      { value: 'value1', type: SupportedDataType.TEXT },
      { value: 'value2', type: SupportedDataType.TEXT },
    ]);

    col2 = makeColumn('col2', 'Column 2', [
      {
        value: 'error-value',
        type: SupportedDataType.TEXT,
        error: new NativeMessage('Test error'),
      },
      { value: 'value4', type: SupportedDataType.TEXT },
    ]);

    col3 = makeColumn('col3', 'Column 3', [
      {
        value: 'ignored-value',
        type: SupportedDataType.TEXT,
        ignore: new NativeMessage('Test ignore'),
      },
      { value: 'value6', type: SupportedDataType.TEXT },
    ]);

    columns = [col1, col2, col3];
  });

  describe('constructor', () => {
    it('should initialize with the provided rowIndex and columns', () => {
      const row = new ImportStatementRow(0, columns);
      expect(row.rowIndex).toBe(0);
    });
  });

  describe('get', () => {
    it('should return cell data for a valid column ID', () => {
      const row = new ImportStatementRow(0, columns);
      const cellData = row.get('col1');
      expect(cellData).toEqual({
        value: 'value1',
        type: SupportedDataType.TEXT,
      });
    });

    it('should return error cell data for an invalid column ID', () => {
      const row = new ImportStatementRow(0, columns);
      const cellData = row.get('nonexistent');
      expect(cellData.value).toBeNull();
      expect(cellData.type).toBe('UNKNOWN');
      expect(cellData.error).toBeInstanceOf(NativeMessage);
      expect((cellData.error as NativeMessage).getText()).toBe(
        'Column not found'
      );
    });

    it('should return default cell data if the row index is out of bounds', () => {
      const row = new ImportStatementRow(10, columns);
      const cellData = row.get('col1');
      expect(cellData).toEqual({
        value: null,
        type: SupportedDataType.UNKNOWN,
      });
    });
  });

  describe('isIgnored', () => {
    it('should return true if any column has an ignore message for the row', () => {
      const row = new ImportStatementRow(0, columns);
      expect(row.isIgnored).toBe(true);
    });

    it('should return false if no columns have an ignore message for the row', () => {
      const row = new ImportStatementRow(1, columns);
      expect(row.isIgnored).toBe(false);
    });

    it('should cache the result of isIgnored', () => {
      const row = new ImportStatementRow(0, columns);
      const first = row.isIgnored;
      // Modify underlying data to try to change outcome; cached value should stay
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing readonly property for testing
      (columns[0].data[0] as any).ignore = new NativeMessage('New ignore');
      const second = row.isIgnored;
      expect(first).toBe(true);
      expect(second).toBe(true);
    });
  });

  describe('hasErrors', () => {
    it('should return true if any column has an error message for the row', () => {
      const row = new ImportStatementRow(0, columns);
      expect(row.hasErrors).toBe(true);
    });

    it('should return false if no columns have an error message for the row', () => {
      const row = new ImportStatementRow(1, columns);
      expect(row.hasErrors).toBe(false);
    });

    it('should cache the result of hasErrors', () => {
      const row = new ImportStatementRow(0, columns);
      const first = row.hasErrors;
      // Modify data after first access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing readonly property for testing
      (columns[1].data[0] as any).error = null;
      const second = row.hasErrors;
      expect(first).toBe(true);
      expect(second).toBe(true);
    });
  });

  describe('errorMessageAt', () => {
    it('should return the error message for a column', () => {
      const row = new ImportStatementRow(0, columns);
      const error = row.errorMessageAt('col2');
      expect(error).toBeInstanceOf(NativeMessage);
      expect((error as NativeMessage).getText()).toBe('Test error');
    });

    it('should return null when there is no error', () => {
      const row = new ImportStatementRow(1, columns);
      const error = row.errorMessageAt('col2');
      expect(error).toBeNull();
    });

    it('should cache the error message per column', () => {
      const row = new ImportStatementRow(0, columns);
      const first = row.errorMessageAt('col2');
      // Change underlying value
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing readonly property for testing
      (columns[1].data[0] as any).error = null;
      const second = row.errorMessageAt('col2');
      expect(first).toBe(second);
    });
  });

  describe('ignoreMessageAt', () => {
    it('should return the ignore message for a column', () => {
      const row = new ImportStatementRow(0, columns);
      const ignore = row.ignoreMessageAt('col3');
      expect(ignore).toBeInstanceOf(NativeMessage);
      expect((ignore as NativeMessage).getText()).toBe('Test ignore');
    });

    it('should return null when there is no ignore message', () => {
      const row = new ImportStatementRow(1, columns);
      const ignore = row.ignoreMessageAt('col3');
      expect(ignore).toBeNull();
    });

    it('should cache the ignore message per column', () => {
      const row = new ImportStatementRow(0, columns);
      const first = row.ignoreMessageAt('col3');
      // Change underlying value
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing readonly property for testing
      (columns[2].data[0] as any).ignore = null;
      const second = row.ignoreMessageAt('col3');
      expect(first).toBe(second);
    });
  });
});
