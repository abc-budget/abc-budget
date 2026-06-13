import { useLang } from '../../../i18n/LangProvider';
import { useT } from '../../../i18n/LangProvider';
import { columnTypeLabel } from '../../../i18n/column-type-label';
import { TypeGlyph } from './TypeGlyph';
import { columnState } from './types';
import type { MappingColumn } from './types';
import './s3b.css';

export interface ColHeaderProps {
  column: MappingColumn;
  isActive: boolean;
  /** Open the column menu for this column id. */
  onOpen: (columnId: string) => void;
}

/**
 * ColHeader — the per-column header button in the raw mapping table.
 *
 * Ported from design-reference/s3b-app.jsx :: ColHeader.  States derived from
 * {definition, recallState} via columnState():
 *   unknown  → loud orange, «? no-type», ▸ unknown
 *   guessed  → gold dashed underline, glyph + label, ◇ from-rules  (item 3:
 *              the recalled `◇` affordance is a distinct loud class, not a dot)
 *   confirmed→ green, glyph + label, ✓ set
 *   ignored  → muted, glyph + label, ignored
 * Pure: props in, onOpen(columnId) out.
 */
export function ColHeader({ column, isActive, onOpen }: ColHeaderProps) {
  const t = useT();
  const { lang } = useLang();
  const state = columnState(column);
  const isUnknown = state === 'unknown';

  return (
    <button
      type="button"
      className={`colh ${state}${isActive ? ' active' : ''}`}
      aria-haspopup="menu"
      aria-expanded={isActive}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(column.id);
      }}
    >
      <span className="colh-rawname f-mono" title={column.rawName}>
        {column.rawName}
      </span>
      <span className="colh-row">
        {isUnknown ? (
          <span className="colh-type f-disp">
            <span className="colh-q" aria-hidden="true">
              ?
            </span>
            {t('s3bUnknownShort')}
          </span>
        ) : (
          <span className="colh-type f-disp">
            <TypeGlyph name={column.definition!} size={13} />
            {columnTypeLabel(column.definition!, lang)}
          </span>
        )}
        <svg
          className="colh-caret"
          viewBox="0 0 24 24"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9 L12 15 L18 9" />
        </svg>
      </span>
      <span className={`colh-state f-mono colh-state-${state}`}>
        {state === 'unknown' && `▸ ${t('s3bUnknown')}`}
        {state === 'ignored' && t('s3bIgnored')}
        {state === 'guessed' && (
          <>
            <span className="colh-recall-glyph" aria-hidden="true">
              ◇
            </span>{' '}
            {t('s3bGuessed')}
          </>
        )}
        {state === 'confirmed' && `✓ ${t('s3bConfirmed')}`}
      </span>
    </button>
  );
}
