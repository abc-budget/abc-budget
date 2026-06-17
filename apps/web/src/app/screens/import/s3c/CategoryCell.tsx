/**
 * CategoryCell — the clickable category cell in the ops table.  A single button
 * target that routes to LOG/ (the screen decides what `onClick` does).  Renders
 * the CatChip when categorized, or the orange «Assign» affordance when not.
 *
 * 4.9c seam: an optional `atypical` slot renders the gold Ring marker.  4.9a
 * never sets it.
 */
import { CatChip } from './CatChip';
import { Ring } from './Ring';
import { Lamp } from '../../../../ui/altus/components/Lamp';
import { useT } from '../../../i18n/LangProvider';
import { WhyIcon } from './icons';
import type { CategoryDTO } from '@abc-budget/engine';
import './s3c.css';

export interface CategoryCellProps {
  category: CategoryDTO | undefined;
  isManual?: boolean;
  /** 4.9c seam — render a Ring atypicality marker when truthy. */
  atypical?: boolean;
  /** 4.9b seam — when set, render an old→new diff (previous → category). */
  previous?: CategoryDTO;
  onClick: () => void;
  lang: 'uk' | 'en';
}

export function CategoryCell({ category, isManual = false, atypical = false, previous, onClick, lang }: CategoryCellProps) {
  const t = useT();
  const has = category != null;
  return (
    <button
      type="button"
      className={`catcell ${has ? 'has' : 'none'}${previous ? ' changed' : ''}`}
      onClick={onClick}
      title={t('s3cWhyTitle')}
    >
      {atypical && <Ring />}
      {has ? (
        <CatChip category={category} previous={previous} isManual={isManual} lang={lang} />
      ) : (
        <span className="catcell-assign">
          <Lamp tone="orange" />
          {t('s3cAssignManual')}
        </span>
      )}
      <WhyIcon className="catcell-why" size={15} />
    </button>
  );
}
