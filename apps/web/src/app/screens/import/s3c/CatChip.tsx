/**
 * CatChip — a category pill: glyph (resolved from icons by `category.icon`) +
 * name + an «ВРУЧНУ» tag when the assignment is manual.  Bound natively to
 * CategoryDTO (id/name/icon/currency).
 *
 * 4.9b seam: an optional `previous` CategoryDTO renders an old→new diff arrow.
 * 4.9a NEVER passes it — the arrow is dead until the re-categorization diff ships.
 */
import { CatIcon } from '../../../../ui/altus/icons';
import { useT } from '../../../i18n/LangProvider';
import type { CategoryDTO } from '@abc-budget/engine';
import './s3c.css';

export interface CatChipProps {
  category: CategoryDTO | undefined;
  isManual?: boolean;
  /** 4.9b seam — when set, render `previous → category` as an old→new diff. */
  previous?: CategoryDTO;
  lang: 'uk' | 'en';
}

function Chip({ category, isManual, manualTag }: { category: CategoryDTO | undefined; isManual?: boolean; manualTag: string }) {
  return (
    <span className={isManual ? 'catchip src-manual' : 'catchip src-rule'}>
      <CatIcon id={category?.icon ?? 'other'} size={15} color="var(--ebony)" />
      <span className="catchip-name f-disp">{category?.name ?? '—'}</span>
      {isManual && <span className="catchip-ovr f-mono">{manualTag}</span>}
    </span>
  );
}

export function CatChip({ category, isManual = false, previous, lang: _lang }: CatChipProps) {
  const t = useT();
  const manualTag = t('s3cOverrideOn');

  if (previous) {
    // 4.9b old→new diff. When the NEW side is null (a sandbox edit that strips the
    // row's category), render the «uncategorized» lost-pill — never drop the old
    // chip to a bare «—» (FINDING-3).
    return (
      <span className="catcell-diff">
        <Chip category={previous} manualTag={manualTag} />
        <span className="catcell-arrow" aria-hidden="true">
          →
        </span>
        {category ? (
          <Chip category={category} isManual={isManual} manualTag={manualTag} />
        ) : (
          <span className="nocat-pill lost f-mono">
            <span className="nocat-dot" aria-hidden="true" />
            {t('s3cSegUncat')}
          </span>
        )}
      </span>
    );
  }
  return <Chip category={category} isManual={isManual} manualTag={manualTag} />;
}
