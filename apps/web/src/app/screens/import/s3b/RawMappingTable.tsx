import { useT } from '../../../i18n/LangProvider';
import { Panel, PanelHeader } from '../../../../ui/altus/components';
import { ColHeader } from './ColHeader';
import { ColMenu } from './ColMenu';
import type { ColMenuProps } from './ColMenu';
import { columnState } from './types';
import type { MappingColumn } from './types';
import './s3b.css';

export interface RawMappingTableProps {
  columns: MappingColumn[];
  /** File label for the panel header (e.g. "export.csv"). */
  fileLabel: string;
  /** Total row count in the file (the sample is a transient window). */
  totalRows: number;
  /** The currently-open column id (its menu renders inline), or null. */
  openColId: string | null;
  onOpenCol: (columnId: string) => void;
  /** Menu callbacks forwarded to ColMenu. */
  menu: Omit<ColMenuProps, 'column'>;
}

/** Per-(transposed)-row parse state from the sample cells we actually have. */
function rowState(cells: Array<{ error?: string; ignore?: string }>): 'ok' | 'error' | 'skipped' {
  if (cells.some((c) => c?.error)) return 'error';
  if (cells.some((c) => c?.ignore)) return 'skipped';
  return 'ok';
}

/**
 * RawMappingTable — the transient raw-statement view.
 *
 * Ported from design-reference/s3b-app.jsx :: RawTable, MINUS the filter
 * toolbar (decision #6 — no raw-toolbar/FILTERS/rtb-*; the All/Error/Skipped
 * filter panel is EP-5/5.1).  The sample rows are TRANSPOSED from each column's
 * parallel `sampleCells`: row i is the i-th sample cell of every column.
 *
 * Per-cell rendering:
 *   empty (null/'')   → em-dash placeholder, .cell-empty
 *   error             → .cell-err + title from the resolved message
 *   ignore            → .cell-ign + title from the resolved message
 *   numeric type col  → .cell-num (amount/balance)
 * Pure: props in, onOpenCol + menu callbacks out.
 */
export function RawMappingTable({
  columns,
  fileLabel,
  totalRows,
  openColId,
  onOpenCol,
  menu,
}: RawMappingTableProps) {
  const t = useT();
  // Transpose: the number of sample rows is the max sampleCells length.
  const rowCount = columns.reduce((max, c) => Math.max(max, c.sampleCells.length), 0);
  const rows = Array.from({ length: rowCount }, (_, ri) =>
    columns.map((c) => c.sampleCells[ri]),
  );

  return (
    <Panel className="rawpanel">
      <PanelHeader logchip="CSV/" title={`${t('s3bRaw')} · ${fileLabel}`}>
        <span className="eyebrow-ink">
          {totalRows} {t('s3bRows')} · {columns.length} {t('s3bCols')}
        </span>
      </PanelHeader>
      <div className="rawscroll">
        <table className="rawtable">
          <thead>
            <tr>
              <th className="th-ps" aria-label="parse state" />
              {columns.map((col) => (
                <th key={col.id} className={columnState(col) === 'ignored' ? 'th-ign' : undefined}>
                  <ColHeader
                    column={col}
                    isActive={openColId === col.id}
                    onOpen={onOpenCol}
                  />
                  {openColId === col.id && <ColMenu column={col} {...menu} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, ri) => {
              const ps = rowState(cells);
              return (
                <tr key={ri} className={ps === 'skipped' ? 'row-skip' : ps === 'error' ? 'row-err' : undefined}>
                  <td className="td-ps">
                    <span className={`ps-dot ps-${ps}`} aria-hidden="true" />
                  </td>
                  {columns.map((col, ci) => {
                    const cell = cells[ci];
                    const state = columnState(col);
                    const value = cell?.value;
                    const empty = value === null || value === undefined || value === '';
                    const isNum = col.definition === 'amount' || col.definition === 'balance';
                    const cls = [
                      isNum ? 'cell-num' : '',
                      state === 'ignored' ? 'cell-ign' : '',
                      cell?.error ? 'cell-err' : '',
                      cell?.ignore ? 'cell-ign' : '',
                      empty ? 'cell-empty' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    const title = cell?.error ?? cell?.ignore ?? undefined;
                    return (
                      <td key={col.id} className={cls || undefined} title={title}>
                        <span className="f-mono">{empty ? '—' : value}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rawfoot f-mono">▸ {t('s3bTransient')}</div>
    </Panel>
  );
}
