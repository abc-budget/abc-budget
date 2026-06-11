/**
 * Stage 2 cell/row data types.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/types.ts`.
 *
 * Trimming: the prior-art stage2/types.ts also contained ImportStatementStage2,
 * ImportStatementColumnHeaderStage2, ImportStatementRowData (Observable-dependent,
 * rxjs-coupled stage interfaces). Those are NOT ported here — column.ts and row.ts
 * only consume CellData and SupportedDataType from this file in 2.2.
 *
 * // 2.3 ports the rest (ImportStatementStage2, ImportStatementColumnHeaderStage2,
 * //                      ImportStatementRowData — requires rxjs).
 *
 * SupportedDataType extension decision (diff-audit note):
 *   COUNTERPARTY outputs a string value.  In the prior art, DESCRIPTION maps to
 *   SupportedDataType.TEXT (column.ts `transformToDescription` returns TEXT cells).
 *   COUNTERPARTY mirrors that mapping exactly — it also writes string text to the
 *   `counterparty` output field (ENT-006), so no new enum member is needed; TEXT
 *   covers both.  TIME produces NO output cells — the transform discards them, so
 *   no new member is needed for TIME either.
 *   Decision: SupportedDataType is ported VERBATIM (no extension required).
 */

import type { Message } from '../../utils/messages/message';

/**
 * Supported data types for cell values.
 * Ported verbatim from prior art — no extension needed for TIME/COUNTERPARTY
 * (TEXT covers COUNTERPARTY; TIME outputs nothing).
 */
export enum SupportedDataType {
  TEXT = 'TEXT',
  DATE = 'DATE',
  NUMBER = 'NUMBER',
  CURRENCY = 'CURRENCY',
  MCC = 'MCC',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Represents data for a single cell in the import process.
 * Ported verbatim from prior art.
 */
export interface CellData {
  /** The value of the cell */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly value: any; // Using 'any' is necessary here as the value can be of various types based on SupportedDataType
  /** Error message if the cell has an error */
  readonly error?: Message | null;
  /** Ignore message if the cell is ignored */
  readonly ignore?: Message | null;
  /** The data type of the cell */
  readonly type: SupportedDataType;
}

// 2.3 ports the rest (ImportStatementStage2, ImportStatementColumnHeaderStage2,
//                      ImportStatementRowData — these require rxjs which is not
//                      a dep of this package in 2.2, and depend on stage1/stage3).
