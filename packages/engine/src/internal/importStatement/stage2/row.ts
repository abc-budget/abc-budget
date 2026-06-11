/**
 * ImportStatementRow — row accessor for stage 2.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/row.ts` (117 lines).
 *
 * Adaptations (import paths only — verbatimModuleSyntax fixes):
 *   `@abc-budget/utils`  → `../../utils/messages/message`
 *                          (NativeMessage, Message — no re-export via barrel needed)
 *   `./column`           → `./column`  (unchanged relative path)
 *   `./types`            → `./types`   (unchanged relative path)
 *
 * All other code is verbatim from prior art.  Diff-audit: zero logic changes.
 */

import type { Message } from '../../utils/messages/message';
import { NativeMessage } from '../../utils/messages/message';
import type { ImportStatementRowData } from './types';
import { ImportStatementColumn } from './column';
import type { CellData } from './types';
import { SupportedDataType } from './types';

/**
 * Implementation of ImportStatementRowData
 * Provides access to row data during import process
 */
export class ImportStatementRow implements ImportStatementRowData {
  readonly rowIndex: number;
  private readonly _columns: ImportStatementColumn[];
  private _cachedErrors: Record<string, Message | null> = {};
  private _cachedIgnores: Record<string, Message | null> = {};
  private _hasErrorsCache: boolean | null = null;
  private _isIgnoredCache: boolean | null = null;

  constructor(rowIndex: number, columns: ImportStatementColumn[]) {
    this.rowIndex = rowIndex;
    this._columns = columns;
  }

  /**
   * Gets cell data from a specific column
   * @param columnId - The column identifier
   * @returns The cell data from the specified column
   */
  get(columnId: string): CellData {
    const column = this._columns.find((col) => col.id === columnId);
    if (!column) {
      return {
        value: null,
        type: SupportedDataType.UNKNOWN,
        error: new NativeMessage('Column not found'),
      };
    }

    return (
      column.data[this.rowIndex] || {
        value: null,
        type: SupportedDataType.UNKNOWN,
      }
    );
  }

  /**
   * Whether this row is marked as ignored
   */
  get isIgnored(): boolean {
    if (this._isIgnoredCache !== null) {
      return this._isIgnoredCache;
    }

    // A row is ignored if any of its columns has an ignore message
    this._isIgnoredCache = this._columns.some((column) => {
      const cellData = column.data[this.rowIndex];
      return (
        cellData && cellData.ignore !== undefined && cellData.ignore !== null
      );
    });

    return this._isIgnoredCache;
  }

  /**
   * Whether this row has validation errors
   */
  get hasErrors(): boolean {
    if (this._hasErrorsCache !== null) {
      return this._hasErrorsCache;
    }

    // A row has errors if any of its columns has an error message
    this._hasErrorsCache = this._columns.some((column) => {
      const cellData = column.data[this.rowIndex];
      return (
        cellData && cellData.error !== undefined && cellData.error !== null
      );
    });

    return this._hasErrorsCache;
  }

  /**
   * Gets the error message for a specific column, if any
   * @param columnId - The column identifier
   * @returns The error message or null if no error
   */
  errorMessageAt(columnId: string): Message | null {
    if (this._cachedErrors[columnId] !== undefined) {
      return this._cachedErrors[columnId];
    }

    const cellData = this.get(columnId);
    const errorMessage = cellData.error || null;
    this._cachedErrors[columnId] = errorMessage;

    return errorMessage;
  }

  /**
   * Gets the ignore message for a specific column, if any
   * @param columnId - The column identifier
   * @returns The ignore message or null if not ignored
   */
  ignoreMessageAt(columnId: string): Message | null {
    if (this._cachedIgnores[columnId] !== undefined) {
      return this._cachedIgnores[columnId];
    }

    const cellData = this.get(columnId);
    const ignoreMessage = cellData.ignore || null;
    this._cachedIgnores[columnId] = ignoreMessage;

    return ignoreMessage;
  }
}
