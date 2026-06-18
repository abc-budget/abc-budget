import { Lamp } from '../../../../ui/altus/components/Lamp';
import { useT } from '../../../i18n/LangProvider';
export interface S3cGateBarProps { remainderCount: number; onAutoOther: () => void; lang: 'uk' | 'en'; }
export function S3cGateBar({ remainderCount, onAutoOther }: S3cGateBarProps) {
  const t = useT();
  const open = remainderCount === 0;
  return (
    <div className={'gate f-mono ' + (open ? 'open' : 'blocked')} data-testid="s3c-gate">
      <Lamp tone={open ? 'green' : 'orange'} />
      <span className="gate-tag">{open ? t('s3cGateOpenTag') : t('s3cGateBlockedTag')}</span>
      <span className="gate-msg">{open ? t('s3cGateOpen') : t('s3cGateBlocked', { n: remainderCount })}</span>
      {!open && <button type="button" className="key beige sm gate-auto" onClick={onAutoOther}>{t('s3cAutoOther')}</button>}
    </div>
  );
}
