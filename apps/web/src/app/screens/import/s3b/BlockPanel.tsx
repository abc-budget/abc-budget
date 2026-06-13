import { useT } from '../../../i18n/LangProvider';
import { Panel, PanelBody, PanelHeader, Key } from '../../../../ui/altus/components';
import type { MappingColumn } from './types';
import './s3b.css';

export interface BlockPanelProps {
  /** The still-UNKNOWN columns blocking the gate. */
  unmappedColumns: MappingColumn[];
  /** Jump to (scroll/open) a column by id. */
  onJump: (columnId: string) => void;
}

/**
 * BlockPanel — the loud UNKNOWN-gate banner (decision #3, Option A).
 *
 * Ported from design-reference/s3b-app.jsx :: BlockPanel.  Renders the orange
 * gate header, the explanatory body, a chip per unmapped column (jump on
 * click), and a «go to first» key.  Shown when the user presses «Next» with
 * ≥1 UNKNOWN column.  Pure: props in, onJump(columnId) out.
 */
export function BlockPanel({ unmappedColumns, onJump }: BlockPanelProps) {
  const t = useT();
  return (
    <Panel className="blockpanel">
      <PanelHeader lamp="orange" title={t('s3bBlockTag')} />
      <PanelBody>
        <p className="body-p block-body">{t('s3bBlockBody')}</p>
        <div className="block-list">
          {unmappedColumns.map((col) => (
            <button
              type="button"
              key={col.id}
              className="block-chip f-mono"
              onClick={() => onJump(col.id)}
            >
              <span className="bc-x" aria-hidden="true">
                ✕
              </span>
              {col.rawName}
            </button>
          ))}
        </div>
        {unmappedColumns.length > 0 && (
          <Key
            variant="orange"
            sm
            onClick={() => onJump(unmappedColumns[0].id)}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12 H19 M13 6 L19 12 L13 18" />
              </svg>
            }
          >
            {t('s3bBlockFix')}
          </Key>
        )}
      </PanelBody>
    </Panel>
  );
}
