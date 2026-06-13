import { useLang, useT } from '../../../i18n/LangProvider';
import { columnTypeLabel } from '../../../i18n/column-type-label';
import { TypeGlyph } from './TypeGlyph';
import { TYPE_ORDER } from './type-order';
import { columnState } from './types';
import type { MappingColumn } from './types';
import './s3b.css';

export interface ColMenuProps {
  column: MappingColumn;
  /** Instant-pick a type (engine definition string). */
  onPick: (columnId: string, definition: string) => void;
  /** Open the «More» 2-step config wizard. */
  onMore: (columnId: string) => void;
  /** Reset the column to UNKNOWN (and unstage). */
  onUndo: (columnId: string) => void;
  /** Reopen the wizard at step 2 to reconfigure params. */
  onReconfigure: (columnId: string) => void;
  /** Confirm a recalled (guessed) column — clears the ◇ flag. */
  onConfirm: (columnId: string) => void;
}

/**
 * ColMenu — the dropdown menu opened from a ColHeader.
 *
 * Ported from design-reference/s3b-app.jsx :: ColMenu.  Positioning + the
 * fixed-overlay anchoring is the Task-4 container's concern (the bundle's
 * anchorRect math is wiring, not presentation) — this stays a pure menu body.
 *
 * Actions present per state:
 *   mapped (any non-unknown): «Reconfigure» + «Undo» always; «Confirm» ONLY
 *     when guessed (recalled, unconfirmed).
 *   the TYPE_ORDER instant-pick list (with a ✓ on the current type) + «More».
 */
export function ColMenu({
  column,
  onPick,
  onMore,
  onUndo,
  onReconfigure,
  onConfirm,
}: ColMenuProps) {
  const t = useT();
  const { lang } = useLang();
  const state = columnState(column);
  const isUnknown = state === 'unknown';
  const isGuessed = state === 'guessed';

  return (
    <div className="colmenu" role="menu" onClick={(e) => e.stopPropagation()}>
      {!isUnknown && (
        <div className="cm-current">
          {isGuessed && (
            <button
              type="button"
              role="menuitem"
              className="cm-confirm"
              onClick={() => onConfirm(column.id)}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 12 L10 18 L20 6" />
              </svg>
              {t('s3bConfirm')}: <b>{columnTypeLabel(column.definition!, lang)}</b>
            </button>
          )}
          <div className="cm-actions">
            <button
              type="button"
              role="menuitem"
              className="cm-act"
              onClick={() => onReconfigure(column.id)}
            >
              {t('s3bReconfigure')}
            </button>
            <button
              type="button"
              role="menuitem"
              className="cm-act cm-undo"
              onClick={() => onUndo(column.id)}
            >
              {t('s3bUndo')}
            </button>
          </div>
          <div className="cm-divider" />
        </div>
      )}
      <div className="cm-pick f-mono">{t('s3bPickType')}</div>
      <div className="cm-list">
        {TYPE_ORDER.map((key) => {
          const sel = column.definition === key;
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={sel}
              key={key}
              className={`cm-item${sel ? ' sel' : ''}${key === 'ignore' ? ' ign' : ''}`}
              onClick={() => onPick(column.id, key)}
            >
              <TypeGlyph name={key} size={15} />
              <span>{columnTypeLabel(key, lang)}</span>
              {sel && (
                <span className="cm-tick" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button type="button" role="menuitem" className="cm-more" onClick={() => onMore(column.id)}>
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="6" cy="12" r="1.4" fill="currentColor" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
          <circle cx="18" cy="12" r="1.4" fill="currentColor" />
        </svg>
        {t('s3bMore')}
      </button>
    </div>
  );
}
