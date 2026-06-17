import { Lamp } from '../../../../ui/altus/components/Lamp';
import { useT } from '../../../i18n/LangProvider';

export interface SandboxBarProps {
  count: number;
  changedOnly: boolean;
  onToggleChangedOnly: () => void;
  onApply: () => void;
  onCancel: () => void;
  lang: 'uk' | 'en';
}

export function SandboxBar({ count, changedOnly, onToggleChangedOnly, onApply, onCancel }: SandboxBarProps) {
  const t = useT();
  return (
    <div className="sandbox-bar" data-testid="sandbox-bar">
      <div className="sb-lhs">
        <Lamp tone="gold" />
        <span className="f-mono sb-tag">{t('s3cSbTag')}</span>
        <span className="f-mono sb-count">{t('s3cSbCount', { n: count })}</span>
      </div>
      <div className="sb-actions">
        <button className={'chip sb-review' + (changedOnly ? ' on' : '')} disabled={count === 0}
          onClick={onToggleChangedOnly}>
          {changedOnly ? t('s3cSbReviewOff') : t('s3cSbReview')}
          {count > 0 && !changedOnly ? ' · ' + count : ''}
        </button>
        <button className="key beige sm" onClick={onCancel}>{t('s3cSbDiscard')}</button>
        <button className="key green sm" onClick={onApply}>{t('s3cSbApply')}</button>
      </div>
    </div>
  );
}
