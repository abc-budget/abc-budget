/**
 * S3b presentational prop shapes.
 *
 * These are PLAIN view-model shapes — NOT the engine DTOs.  The Task-4 container
 * adapts a Stage2SnapshotDTO (where `originalName` and cell errors are
 * `SerializedMessage`s, and `value` is `unknown`) into these resolved,
 * already-localized shapes so the components stay pure (props in, callbacks out,
 * zero engine imports).
 */

/** A resolved sample cell for the raw mapping table. */
export interface MappingCell {
  /** The cell's display value; null/'' renders as the em-dash placeholder. */
  value: string | null;
  /** Resolved error message (→ title text + error styling), if the cell errored. */
  error?: string;
  /** Resolved ignore message (→ title text + ignore styling), if the cell is ignored. */
  ignore?: string;
}

/** A resolved column view-model. */
export interface MappingColumn {
  id: string;
  /** The raw/original header name (already resolved from SerializedMessage). */
  rawName: string;
  /**
   * The engine ColumnDefinition string, or null for an UNKNOWN (unmapped)
   * column.  'ignore' is a definition like any other (rendered as the ignored
   * state).
   */
  definition: string | null;
  /** Recall provenance: 'guessed' (recalled, unconfirmed) / 'confirmed' / null. */
  recallState: 'guessed' | 'confirmed' | null;
  /** Parallel sample cells; row i across all columns = the i-th transposed row. */
  sampleCells: MappingCell[];
}

/** Derived display state of a column header / status row. */
export type ColumnState = 'unknown' | 'guessed' | 'confirmed' | 'ignored';

/** Computes the display state from a column's definition + recallState. */
export function columnState(col: Pick<MappingColumn, 'definition' | 'recallState'>): ColumnState {
  if (col.definition === null || col.definition === 'unknown') return 'unknown';
  if (col.definition === 'ignore') return 'ignored';
  return col.recallState === 'guessed' ? 'guessed' : 'confirmed';
}
