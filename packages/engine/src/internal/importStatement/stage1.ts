/**
 * ImportStatementStage1 — raw-data stage of the import pipeline.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage1.ts`.
 *
 * Adaptations (diff-audit):
 *   1. **Import paths**: `'rxjs'` → `'rxjs'` (unchanged — rxjs is now a dep);
 *      `'./service'` → `'./service'`; `'./types'` → `'./types'`.
 *   2. **IoC removal**: None needed — stage1.ts has no Container dependency.
 *   3. **verbatimModuleSyntax**: type-only imports use `import type`.
 *
 * NOTHING else changes from the verbatim prior art.
 */

import { Observable, of } from 'rxjs'; // rxjs — INTERNAL only (1.1 rule: no Observables on public surface)
import type { ImportStatementServiceInternal } from './service';
import type { ImportStatementStage2 } from './stage2/types';
import type { ImportStatementStage } from './types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * First stage of the import statement process.
 * Handles raw string data and allows moving to the second stage.
 */
export interface ImportStatementStage1
  extends ImportStatementStage<string, Record<string, unknown>> {
  /**
   * Proceeds to the next stage of the import process
   * @returns Promise resolving to the second stage
   */
  next(): Promise<ImportStatementStage2>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Implementation of the ImportStatementStage1 interface.
 * This stage is designed to show raw data on the screen and prepare it for column mapping.
 */
export class ImportStatementStage1Impl implements ImportStatementStage1 {
  private readonly _columns;
  private readonly _data;

  /**
   * Constructor
   * @param rawData - The raw data to be processed
   * @param service - The internal service used to create Stage2
   */
  constructor(
    rawData: Record<string, unknown>[],
    private readonly service: ImportStatementServiceInternal
  ) {
    // Validate and process the input data
    if (!rawData || rawData.length === 0) {
      throw new Error('Import data cannot be empty');
    }

    // Extract columns from the first row
    const firstRow = rawData[0];
    const columns = Object.keys(firstRow);
    this._columns = of(columns);

    // Validate that all rows have the same columns
    for (let i = 1; i < rawData.length; i++) {
      const rowColumns = Object.keys(rawData[i]);

      // Check if the row has the same number of columns
      if (rowColumns.length !== columns.length) {
        throw new Error(
          `Row ${i} has a different number of columns than the first row`
        );
      }

      // Check if the row has the same column names
      for (const column of columns) {
        if (!rowColumns.includes(column)) {
          throw new Error(`Row ${i} is missing column "${column}"`);
        }
      }
    }

    // Store the data
    this._data = of([...rawData]);
  }

  /**
   * Gets the current data rows for this stage as a subscribable
   */
  get currentData(): Observable<Record<string, unknown>[]> {
    return this._data;
  }

  /**
   * Gets the column definitions for this stage as a subscribable
   */
  get columns(): Observable<string[]> {
    return this._columns;
  }

  /**
   * Proceeds to the next stage of the import process
   * @returns Promise resolving to the second stage
   */
  async next(): Promise<ImportStatementStage2> {
    return this.service.stage2(this);
  }
}
