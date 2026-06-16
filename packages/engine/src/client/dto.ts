/**
 * Data Transfer Objects + pure serializer functions for the EngineClient session
 * protocol (contract v3 — GenerateResultDTO gained `structuralErrors` at 2.7).
 *
 * All types are JSON-safe by design (no Date, no class instances, no RxJS).
 * Serializers are pure functions over internal objects — no worker required.
 *
 * Row-economy guarantee (founder refinement 2):
 *   Stage2 snapshots NEVER re-ship the full row set.  Per-column cell samples
 *   are capped at SNAPSHOT_CELLS_PER_COLUMN_MAX so snapshot byte-size does NOT
 *   scale with total row count.  Full row data flows only through importGetRows.
 */

import type { Message } from '../internal/utils/messages/message';
import { LocalizableMessage } from '../internal/utils/messages/message';
import type { ColumnDefinition, ColumnParams } from '../internal/importStatement/types';
import type { ImportStatementColumnHeaderStage2 } from '../internal/importStatement/stage2/types';
import type { ColumnTransformRejection } from '../internal/importStatement/stage2/errors';
import type {
  GenerateRowsResult,
  RowError,
  SkippedRow,
  TransactionRow,
} from '../internal/importStatement/stage3/types';
import type { CollisionDescriptor } from '../internal/importStatement/recall/recall';

// ── Serialized message shape ──────────────────────────────────────────────────

/**
 * Serialized form of an internal Message object.
 *
 * - Localizable messages: {key, params} — the UI catalog renders at 2.7/2.8.
 * - Native (raw text) messages: {text} — serialized verbatim.
 */
export type SerializedMessage =
  | { readonly key: string; readonly params: Record<string, unknown> }
  | { readonly text: string };

/**
 * Serialize an internal Message to its wire form.
 * LocalizableMessage → {key, params}; NativeMessage → {text}.
 */
export function serializeMessage(msg: Message): SerializedMessage {
  if (msg instanceof LocalizableMessage) {
    return { key: msg.getText(), params: msg.getParams() };
  }
  return { text: msg.getText() };
}

// ── Column snapshot ───────────────────────────────────────────────────────────

/**
 * Maximum number of sample cells per column in a Stage2SnapshotDTO.
 *
 * Set to 10 — matching the 2.2 format-detection default sample percentage (10%
 * of a 100-row file = 10 cells, the practical floor for the evenly-spaced
 * sampling in collections/sampling.ts).  For display, 10 cells per column is
 * sufficient to show the user what the data looks like.
 *
 * Row-economy pin: snapshot byte-size for a 10k-row session must be within 2×
 * of a 12-row session's (column counts equal) — asserted in dto.spec.ts.
 * With this cap both the 12-row and 10k-row session produce ≤10 sample cells
 * per column, so the wire size is bounded and does NOT scale with row count.
 */
export const SNAPSHOT_CELLS_PER_COLUMN_MAX = 10;

/** Serialized cell in a column snapshot (value + optional error/ignore). */
export interface SnapshotCellDTO {
  readonly value: unknown;
  readonly error?: SerializedMessage;
  readonly ignore?: SerializedMessage;
}

/** Serialized column in a Stage2SnapshotDTO. */
export interface Stage2ColumnDTO {
  readonly id: string;
  readonly originalName: SerializedMessage;
  readonly definition: ColumnDefinition | null;
  readonly params: ColumnParams | null;
  readonly recallState: 'guessed' | 'confirmed' | null;
  /** Cell sample, capped at SNAPSHOT_CELLS_PER_COLUMN_MAX. */
  readonly sampleCells: SnapshotCellDTO[];
}

/** Serialized collision descriptor. */
export interface CollisionDTO {
  readonly kind: 'type-change' | 'params-change';
  readonly existing: { readonly definition: ColumnDefinition; readonly params: ColumnParams | null };
  readonly incoming: { readonly definition: ColumnDefinition; readonly params: ColumnParams | null };
}

/** Snapshot of stage2 state — column defs, recognized count, collision, unmapped list. */
export interface Stage2SnapshotDTO {
  readonly columns: Stage2ColumnDTO[];
  readonly recognized: { readonly n: number; readonly m: number };
  readonly lastSaveCollision: CollisionDTO | null;
  readonly unmapped: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

/** Input to serializeStage2Snapshot — mirrors the fields on ImportStatementStage2Impl. */
export interface Stage2SnapshotInput {
  readonly columns: ReadonlyArray<ImportStatementColumnHeaderStage2>;
  readonly recognized: { readonly n: number; readonly m: number };
  readonly lastSaveCollision: CollisionDescriptor | null;
  readonly unmappedColumns: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

/** Serialize a cell, capping and serializing message fields. */
function serializeCell(cell: { value: unknown; error?: Message | null; ignore?: Message | null }): SnapshotCellDTO {
  const result: {
    value: unknown;
    error?: SerializedMessage;
    ignore?: SerializedMessage;
  } = { value: cell.value };
  if (cell.error != null) result.error = serializeMessage(cell.error);
  if (cell.ignore != null) result.ignore = serializeMessage(cell.ignore);
  return result;
}

/** Serialize a CollisionDescriptor to its DTO form. */
function serializeCollision(c: CollisionDescriptor): CollisionDTO {
  return {
    kind: c.kind,
    existing: { definition: c.existing.definition, params: c.existing.params },
    incoming: { definition: c.incoming.definition, params: c.incoming.params },
  };
}

/**
 * Serialize a Stage2 snapshot to its wire DTO.
 *
 * Row economy: each column's cells are capped at SNAPSHOT_CELLS_PER_COLUMN_MAX
 * (evenly spaced — the 2.2 sampling convention).
 */
export function serializeStage2Snapshot(input: Stage2SnapshotInput): Stage2SnapshotDTO {
  const columns: Stage2ColumnDTO[] = input.columns.map((col) => {
    // Access data through the column; ImportStatementColumn exposes `.data`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawData: Array<{ value: unknown; error?: Message | null; ignore?: Message | null }> = (col as any).data ?? [];
    const total = rawData.length;

    // Evenly-spaced sample capped at SNAPSHOT_CELLS_PER_COLUMN_MAX (row economy pin)
    let sampleData: typeof rawData;
    if (total <= SNAPSHOT_CELLS_PER_COLUMN_MAX) {
      sampleData = rawData;
    } else {
      sampleData = [];
      const size = SNAPSHOT_CELLS_PER_COLUMN_MAX;
      for (let i = 0; i < size; i++) {
        sampleData.push(rawData[Math.floor((i * total) / size)]);
      }
    }

    return {
      id: col.id,
      originalName: serializeMessage(col.originalName),
      definition: col.definition,
      params: col.params,
      recallState: col.recallState,
      sampleCells: sampleData.map(serializeCell),
    };
  });

  return {
    columns,
    recognized: { n: input.recognized.n, m: input.recognized.m },
    lastSaveCollision: input.lastSaveCollision ? serializeCollision(input.lastSaveCollision) : null,
    unmapped: input.unmappedColumns.map((u) => ({ id: u.id, name: u.name })),
  };
}

// ── Column rejection ──────────────────────────────────────────────────────────

/** Serialized per-cell error entry from ColumnTransformRejection. */
export interface CellErrorDTO {
  readonly rowIndex: number;
  readonly columnId?: string;
  readonly message: SerializedMessage;
}

/** Serialized ColumnTransformRejection. */
export interface ColumnRejectionDTO {
  readonly errorCount: number;
  readonly totalCount: number;
  readonly threshold: number;
  readonly cellErrors: CellErrorDTO[];
}

/** Serialize a ColumnTransformRejection to its wire DTO. */
export function serializeColumnRejection(rejection: ColumnTransformRejection): ColumnRejectionDTO {
  return {
    errorCount: rejection.errorCount,
    totalCount: rejection.totalCount,
    threshold: rejection.threshold,
    cellErrors: rejection.cellErrors.map((ce) => ({
      rowIndex: ce.rowIndex,
      message: serializeMessage(ce.error),
    })),
  };
}

// ── Row window ────────────────────────────────────────────────────────────────

/** Serialized TransactionRow — date is an ISO string. */
export interface TransactionRowDTO {
  readonly rowIndex: number;
  readonly hash: string;
  readonly date: string; // ISO 8601
  readonly amount: number;
  readonly currency: string;
  readonly description: string | null;
  readonly counterparty: string | null;
  readonly account: string | null;
  readonly bankCategory: string | null;
  readonly mcc: number | null;
  readonly isBankCommission: boolean;
  readonly isCashback: boolean;
  readonly category: unknown;
  readonly isManuallySetCategory: boolean;
}

/** Windowed row access result (importGetRows). */
export interface RowWindowDTO {
  readonly offset: number;
  readonly total: number;
  readonly rows: TransactionRowDTO[];
}

function serializeRow(row: TransactionRow): TransactionRowDTO {
  return {
    rowIndex: row.rowIndex,
    hash: row.hash,
    date: row.date instanceof Date ? row.date.toISOString() : String(row.date),
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    counterparty: row.counterparty,
    account: row.account,
    bankCategory: row.bankCategory,
    mcc: row.mcc,
    isBankCommission: row.isBankCommission,
    isCashback: row.isCashback,
    category: row.category,
    isManuallySetCategory: row.isManuallySetCategory,
  };
}

/**
 * Serialize a windowed slice of transaction rows to a RowWindowDTO.
 * @param rows   The slice of rows (already windowed by the caller).
 * @param offset The offset of the first row in the full result set.
 * @param total  The total number of rows in the full result set.
 */
export function serializeRowWindow(
  rows: TransactionRow[],
  offset: number,
  total: number,
): RowWindowDTO {
  return { offset, total, rows: rows.map(serializeRow) };
}

// ── Generate result ───────────────────────────────────────────────────────────

/** Serialized RowError entry. */
export interface RowErrorDTO {
  readonly rowIndex: number;
  readonly columnId?: string;
  readonly errors: SerializedMessage[];
}

/** Serialized SkippedRow entry. */
export interface SkippedRowDTO {
  readonly rowIndex: number;
  readonly reason: SerializedMessage;
}

/** Serialized GenerateRowsResult (from importNext). */
export interface GenerateResultDTO {
  readonly rows: TransactionRowDTO[];
  readonly rowErrors: RowErrorDTO[];
  readonly skipped: SkippedRowDTO[];
  /**
   * 2.7 decision 2 (contract v3): column-SET-level failures detected BEFORE the
   * row loop (no-DATE / multiple-DATE mapping). ONE message per condition; when
   * non-empty the other three arrays are ALL empty (the loop never ran).
   */
  readonly structuralErrors: SerializedMessage[];
}

/** Serialize a GenerateRowsResult to its wire DTO. */
export function serializeGenerateResult(result: GenerateRowsResult): GenerateResultDTO {
  return {
    rows: result.rows.map(serializeRow),
    rowErrors: result.rowErrors.map((re: RowError) => ({
      rowIndex: re.rowIndex,
      columnId: re.columnId,
      errors: re.errors.map(serializeMessage),
    })),
    skipped: result.skipped.map((s: SkippedRow) => ({
      rowIndex: s.rowIndex,
      reason: serializeMessage(s.reason),
    })),
    structuralErrors: result.structuralErrors.map(serializeMessage),
  };
}

// ── Unmapped columns ──────────────────────────────────────────────────────────

/** Serialized UnmappedColumnsError payload. */
export interface UnmappedColumnsDTO {
  readonly unmappedColumns: ReadonlyArray<{ readonly id: string; readonly name: string }>;
}

/** Serialize the unmapped column list from UnmappedColumnsError. */
export function serializeUnmappedColumns(
  unmappedColumns: ReadonlyArray<{ id: string; name: string }>,
): UnmappedColumnsDTO {
  return {
    unmappedColumns: unmappedColumns.map((u) => ({ id: u.id, name: u.name })),
  };
}
