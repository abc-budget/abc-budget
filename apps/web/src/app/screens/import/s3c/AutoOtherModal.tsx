/**
 * AutoOtherModal — conscious-confirm modal for the Auto-Other remainder
 * assignment.  Shows the magnitude (≈ base total + per-currency pending tail),
 * a category picker (defaults to the last-used remainder category), and a
 * transient-assignment note.
 *
 * The confirm button stays disabled until a category is chosen.  The picker
 * defaults to `magnitude.lastRemainderCategoryId` so a confirm with no further
 * interaction fires `onConfirm(lastRemainderCategoryId)`.
 */
import { useState } from 'react';
import { Lamp } from '../../../../ui/altus/components/Lamp';
import { useT } from '../../../i18n/LangProvider';
import { CategoryPicker } from './CategoryPicker';
import { fmtAmount } from './money';
import type { CategoryDTO, RemainderMagnitudeDTO } from '@abc-budget/engine';
import './s3c.css';

export interface AutoOtherModalProps {
  magnitude: RemainderMagnitudeDTO;
  categories: CategoryDTO[];
  onConfirm: (categoryId: string) => void;
  onCancel: () => void;
  onCreateCategory: (name: string) => void;
  lang: 'uk' | 'en';
}

export function AutoOtherModal({
  magnitude,
  categories,
  onConfirm,
  onCancel,
  onCreateCategory,
  lang,
}: AutoOtherModalProps) {
  const t = useT();
  const [chosen, setChosen] = useState<string | null>(magnitude.lastRemainderCategoryId);

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="create-modal autoother-modal" role="dialog" aria-modal="true" aria-label={t('s3cAoTitle')} onClick={(e) => e.stopPropagation()}>
        <span className="screw" aria-hidden="true" style={{ top: 12, left: 12 }} />
        <span className="screw" aria-hidden="true" style={{ top: 12, right: 12 }} />
        <div className="modal-h">
          <Lamp tone="gold" />
          <span className="f-disp modal-title">{t('s3cAoTitle')}</span>
        </div>
        <div className="ao-magnitude">
          <div className="ao-count">
            <span className="ao-count-n f-mono">{magnitude.opCount}</span>
            <span className="ao-count-of f-mono">{t('s3cAoOf', { n: magnitude.totalOpCount })}</span>
          </div>
          <div className="ao-sums">
            <span className="ao-sums-lab f-mono">{t('s3cAoSumLab')}</span>
            <div className="ao-sums-row">
              <span className="ao-approx">≈</span>
              <span className="ao-sum f-mono">{fmtAmount(magnitude.baseTotal, magnitude.baseCurrency)}</span>
            </div>
            {magnitude.pending.length > 0 && (
              <div className="ao-pending">
                {magnitude.pending.map((p) => (
                  <span className="ao-pend f-mono" key={p.currency}>
                    + {fmtAmount(p.amount, p.currency)}{' '}
                    <span className="ao-pend-note">({p.currency} · {t('s3cAoRatePending')})</span>
                  </span>
                ))}
              </div>
            )}
            <span className="ao-sums-note f-mono">▸ {t('s3cAoApproxNote')}</span>
          </div>
        </div>
        <span className="f-mono bulk-catlab">{t('s3cAoPick')}</span>
        <CategoryPicker
          categories={categories}
          currentId={chosen}
          onPick={setChosen}
          onCreate={onCreateCategory}
          lang={lang}
        />
        <div className="ao-transient f-mono">▸ {t('s3cAoTransient')}</div>
        <div className="modal-actions">
          <button type="button" className="key beige sm" onClick={onCancel}>
            {t('s3cCancel')}
          </button>
          <button
            type="button"
            className="key gold sm"
            disabled={!chosen}
            onClick={() => chosen && onConfirm(chosen)}
          >
            {t('s3cAutoOther')}
          </button>
        </div>
      </div>
    </div>
  );
}
