/**
 * DTO round-trip tests — shape fidelity per DTO from real internal objects.
 *
 * TDD: these tests were written BEFORE dto.ts was implemented. They assert
 * that every serializer produces the expected wire shape and that the shape
 * is JSON-safe (no Date objects, no Message instances, no RxJS).
 */

import { describe, it, expect } from 'vitest';
import { NativeMessage, LocalizableMessage } from '../internal/utils/messages/message';
import { ColumnDefinition } from '../internal/importStatement/types';
import type { DateColumnParams } from '../internal/importStatement/types';
import { ImportStatementColumn } from '../internal/importStatement/stage2/column';
import { SupportedDataType } from '../internal/importStatement/stage2/types';
import type { CellData } from '../internal/importStatement/stage2/types';
import { ColumnTransformRejection } from '../internal/importStatement/stage2/errors';
import type { GenerateRowsResult, TransactionRow, RowError, SkippedRow } from '../internal/importStatement/stage3/types';
import {
  serializeMessage,
  serializeStage2Snapshot,
  serializeColumnRejection,
  serializeRowWindow,
  serializeGenerateResult,
  serializeUnmappedColumns,
  SNAPSHOT_CELLS_PER_COLUMN_MAX,
} from './dto';
import type {
  Stage2SnapshotDTO,
  ColumnRejectionDTO,
  RowWindowDTO,
  GenerateResultDTO,
  UnmappedColumnsDTO,
} from './dto';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCell(value: unknown, type = SupportedDataType.TEXT): CellData {
  return { value, type } as CellData;
}

function makeColumn(
  id: string,
  name: string,
  data: CellData[] = [],
  definition: ColumnDefinition | null = null,
  params: DateColumnParams | null = null,
  recallState: 'guessed' | 'confirmed' | null = null,
): ImportStatementColumn {
  const nameMsg = new NativeMessage(name);
  return new ImportStatementColumn(id, nameMsg, nameMsg, definition, params, data, null, recallState);
}

// ── serializeMessage ─────────────────────────────────────────────────────────

describe('serializeMessage', () => {
  it('serializes a NativeMessage as {text}', () => {
    const msg = new NativeMessage('raw text');
    const result = serializeMessage(msg);
    expect(result).toEqual({ text: 'raw text' });
  });

  it('serializes a LocalizableMessage as {key, params}', () => {
    const msg = new LocalizableMessage('engine.some.key', { count: 3 });
    const result = serializeMessage(msg);
    expect(result).toEqual({ key: 'engine.some.key', params: { count: 3 } });
  });

  it('LocalizableMessage with no params serializes as {key, params: {}}', () => {
    const msg = new LocalizableMessage('engine.foo');
    const result = serializeMessage(msg);
    expect(result).toEqual({ key: 'engine.foo', params: {} });
  });
});

// ── serializeStage2Snapshot ───────────────────────────────────────────────────

describe('serializeStage2Snapshot', () => {
  it('serializes a basic snapshot — column id/originalName/definition/params/recallState', () => {
    const dateParams: DateColumnParams = { format: 'auto' };
    const col = makeColumn('col-1', 'Date', [makeCell('2024-01-01')], ColumnDefinition.DATE, dateParams, 'guessed');
    const snapshot: Stage2SnapshotDTO = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 1, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });

    expect(snapshot.columns).toHaveLength(1);
    const c = snapshot.columns[0];
    expect(c.id).toBe('col-1');
    expect(c.originalName).toEqual({ text: 'Date' });
    expect(c.definition).toBe(ColumnDefinition.DATE);
    expect(c.params).toEqual(dateParams);
    expect(c.recallState).toBe('guessed');
  });

  it('includes recognized and unmapped', () => {
    const col = makeColumn('col-x', 'Unknown');
    const snapshot = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 0, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [{ id: 'col-x', name: 'Unknown' }],
    });
    expect(snapshot.recognized).toEqual({ n: 0, m: 1 });
    expect(snapshot.unmapped).toEqual([{ id: 'col-x', name: 'Unknown' }]);
  });

  it('serializes lastSaveCollision when present', () => {
    const col = makeColumn('col-1', 'Amount', [], ColumnDefinition.AMOUNT);
    const snapshot = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 0, m: 1 },
      lastSaveCollision: {
        kind: 'type-change',
        existing: { definition: ColumnDefinition.DATE, params: null },
        incoming: { definition: ColumnDefinition.AMOUNT, params: null },
      },
      unmappedColumns: [],
    });
    expect(snapshot.lastSaveCollision).not.toBeNull();
    expect(snapshot.lastSaveCollision?.kind).toBe('type-change');
    expect(snapshot.lastSaveCollision?.existing.definition).toBe(ColumnDefinition.DATE);
    expect(snapshot.lastSaveCollision?.incoming.definition).toBe(ColumnDefinition.AMOUNT);
  });

  it('serializes cell error messages in sampleCells', () => {
    const errorMsg = new LocalizableMessage('engine.some.error', { val: 'bad' });
    const cell: CellData = { value: 'bad', type: SupportedDataType.TEXT, error: errorMsg };
    const col = makeColumn('col-1', 'Date', [cell], ColumnDefinition.DATE);
    const snapshot = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 1, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });
    const c = snapshot.columns[0];
    expect(c.sampleCells).toHaveLength(1);
    const sc = c.sampleCells[0];
    expect(sc.error).toEqual({ key: 'engine.some.error', params: { val: 'bad' } });
  });

  it('serializes cell ignore messages in sampleCells', () => {
    const ignoreMsg = new NativeMessage('income skipped');
    const cell: CellData = { value: 'x', type: SupportedDataType.TEXT, ignore: ignoreMsg };
    const col = makeColumn('col-1', 'Amount', [cell], ColumnDefinition.AMOUNT);
    const snapshot = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 0, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });
    const sc = snapshot.columns[0].sampleCells[0];
    expect(sc.ignore).toEqual({ text: 'income skipped' });
  });

  it('row-economy: snapshot sampleCells capped at SNAPSHOT_CELLS_PER_COLUMN_MAX', () => {
    // build a column with more cells than the cap
    const count = SNAPSHOT_CELLS_PER_COLUMN_MAX + 50;
    const cells: CellData[] = Array.from({ length: count }, (_, i) => makeCell(`val${i}`));
    const col = makeColumn('col-big', 'BigCol', cells, ColumnDefinition.DESCRIPTION);
    const snapshot = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 0, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });
    expect(snapshot.columns[0].sampleCells.length).toBeLessThanOrEqual(SNAPSHOT_CELLS_PER_COLUMN_MAX);
  });

  it('row-economy pin: 10k-row snapshot has similar byte-size to 12-row snapshot (same columns)', () => {
    // Build two columns with equal shape but 10k vs 12 rows
    const makeColSet = (rowCount: number) => {
      const cells: CellData[] = Array.from({ length: rowCount }, (_, i) => makeCell(`v${i}`));
      return [makeColumn('col-a', 'Date', cells, ColumnDefinition.DATE)];
    };

    const snap12 = serializeStage2Snapshot({
      columns: makeColSet(12),
      recognized: { n: 1, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });
    const snap10k = serializeStage2Snapshot({
      columns: makeColSet(10_000),
      recognized: { n: 1, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });

    const size12 = JSON.stringify(snap12).length;
    const size10k = JSON.stringify(snap10k).length;
    // PIN: 10k snapshot must be within 2× of the 12-row snapshot
    expect(size10k).toBeLessThanOrEqual(size12 * 2);
  });

  it('is JSON-safe (no Date objects, no class instances)', () => {
    const col = makeColumn('col-1', 'Desc', [makeCell('hello')], ColumnDefinition.DESCRIPTION);
    const snapshot = serializeStage2Snapshot({
      columns: [col],
      recognized: { n: 0, m: 1 },
      lastSaveCollision: null,
      unmappedColumns: [],
    });
    // JSON round-trip must be lossless for the DTO
    const roundTrip = JSON.parse(JSON.stringify(snapshot));
    expect(roundTrip).toEqual(snapshot);
  });
});

// ── serializeColumnRejection ──────────────────────────────────────────────────

describe('serializeColumnRejection', () => {
  it('serializes errorCount/totalCount/threshold', () => {
    const rejection = new ColumnTransformRejection(
      3, 10, 0.3,
      [{ rowIndex: 0, error: new NativeMessage('bad cell') }],
      'engine.importStatement.column-parse-error',
    );
    const dto: ColumnRejectionDTO = serializeColumnRejection(rejection);
    expect(dto.errorCount).toBe(3);
    expect(dto.totalCount).toBe(10);
    expect(dto.threshold).toBe(0.3);
  });

  it('serializes cellErrors with rowIndex and serialized message', () => {
    const err = new LocalizableMessage('engine.importStatement.parse-error', { col: 'Date' });
    const rejection = new ColumnTransformRejection(
      1, 5, 0.3,
      [{ rowIndex: 2, error: err }],
      'engine.importStatement.column-parse-error',
    );
    const dto = serializeColumnRejection(rejection);
    expect(dto.cellErrors).toHaveLength(1);
    expect(dto.cellErrors[0].rowIndex).toBe(2);
    expect(dto.cellErrors[0].message).toEqual({ key: 'engine.importStatement.parse-error', params: { col: 'Date' } });
  });

  it('round-trip: JSON-safe DTO', () => {
    const rejection = new ColumnTransformRejection(
      2, 8, 0.3,
      [{ rowIndex: 1, error: new NativeMessage('err') }],
      'engine.importStatement.column-parse-error',
    );
    const dto = serializeColumnRejection(rejection);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});

// ── serializeRowWindow ────────────────────────────────────────────────────────

describe('serializeRowWindow', () => {
  const makeRow = (rowIndex: number): TransactionRow => ({
    rowIndex,
    hash: `hash-${rowIndex}`,
    source: null,
    date: new Date('2024-01-15T00:00:00.000Z'),
    amount: 42,
    currency: 'USD',
    description: 'Coffee',
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
  });

  it('serializes offset/total and rows count', () => {
    const dto: RowWindowDTO = serializeRowWindow([makeRow(0), makeRow(1)], 0, 10);
    expect(dto.offset).toBe(0);
    expect(dto.total).toBe(10);
    expect(dto.rows).toHaveLength(2);
  });

  it('serializes date as ISO string', () => {
    const dto = serializeRowWindow([makeRow(0)], 0, 1);
    expect(dto.rows[0].date).toBe('2024-01-15T00:00:00.000Z');
    expect(typeof dto.rows[0].date).toBe('string');
  });

  it('is JSON-safe', () => {
    const dto = serializeRowWindow([makeRow(0), makeRow(1)], 5, 20);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});

// ── serializeGenerateResult ───────────────────────────────────────────────────

describe('serializeGenerateResult', () => {
  const makeRow = (rowIndex: number): TransactionRow => ({
    rowIndex,
    hash: `h${rowIndex}`,
    source: null,
    date: new Date('2024-03-01T00:00:00.000Z'),
    amount: 10,
    currency: 'UAH',
    description: null,
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
  });

  it('serializes rows with ISO dates', () => {
    const result: GenerateRowsResult = {
      rows: [makeRow(0)],
      rowErrors: [],
      skipped: [],
      structuralErrors: [],
    };
    const dto: GenerateResultDTO = serializeGenerateResult(result);
    expect(dto.rows[0].date).toBe('2024-03-01T00:00:00.000Z');
    expect(dto.structuralErrors).toEqual([]);
  });

  // Decision 2 (2.7): the structural channel crosses the wire as SerializedMessage[]
  it('serializes structuralErrors as SerializedMessage[] (decision 2, contract v3)', () => {
    const result: GenerateRowsResult = {
      rows: [],
      rowErrors: [],
      skipped: [],
      structuralErrors: [
        new LocalizableMessage('engine.importStatement.stage3.structural-no-date-column', {}),
      ],
    };
    const dto = serializeGenerateResult(result);
    expect(dto.structuralErrors).toEqual([
      { key: 'engine.importStatement.stage3.structural-no-date-column', params: {} },
    ]);
    // zero row-error echoes (PIN b)
    expect(dto.rowErrors).toHaveLength(0);
  });

  it('serializes rowErrors with serialized messages', () => {
    const rowError: RowError = {
      rowIndex: 3,
      errors: [new LocalizableMessage('engine.row.error', { field: 'amount' })],
      columnId: 'col-amount',
    };
    const result: GenerateRowsResult = { rows: [], rowErrors: [rowError], skipped: [], structuralErrors: [] };
    const dto = serializeGenerateResult(result);
    expect(dto.rowErrors).toHaveLength(1);
    expect(dto.rowErrors[0].rowIndex).toBe(3);
    expect(dto.rowErrors[0].columnId).toBe('col-amount');
    expect(dto.rowErrors[0].errors).toEqual([
      { key: 'engine.row.error', params: { field: 'amount' } },
    ]);
  });

  it('serializes skipped rows with serialized reason', () => {
    const skipped: SkippedRow = {
      rowIndex: 5,
      reason: new NativeMessage('income skipped'),
    };
    const result: GenerateRowsResult = { rows: [], rowErrors: [], skipped: [skipped], structuralErrors: [] };
    const dto = serializeGenerateResult(result);
    expect(dto.skipped[0].reason).toEqual({ text: 'income skipped' });
  });

  it('is JSON-safe', () => {
    const result: GenerateRowsResult = { rows: [makeRow(0)], rowErrors: [], skipped: [], structuralErrors: [] };
    const dto = serializeGenerateResult(result);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});

// ── serializeUnmappedColumns ──────────────────────────────────────────────────

describe('serializeUnmappedColumns', () => {
  it('serializes the unmapped list', () => {
    const dto: UnmappedColumnsDTO = serializeUnmappedColumns([
      { id: 'col-a', name: 'ColA' },
      { id: 'col-b', name: 'ColB' },
    ]);
    expect(dto.unmappedColumns).toEqual([
      { id: 'col-a', name: 'ColA' },
      { id: 'col-b', name: 'ColB' },
    ]);
  });

  it('is JSON-safe', () => {
    const dto = serializeUnmappedColumns([{ id: 'x', name: 'X' }]);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});
