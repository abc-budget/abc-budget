import { Ring } from './Ring';
import { useT } from '../../../i18n/LangProvider';
export interface SelfCheckBannerProps { count: number; atypFirst: boolean; onToggleSort: () => void; onHide: () => void; lang: 'uk' | 'en'; }
export function SelfCheckBanner({ count, atypFirst, onToggleSort, onHide }: SelfCheckBannerProps) {
  const t = useT();
  return (
    <div className="scheck" data-testid="self-check">
      <span className="scheck-ring"><Ring size={16} /></span>
      <div className="scheck-main">
        <div className="scheck-eye f-mono">{t('s3cScEye')}</div>
        <div className="scheck-body">{t('s3cScBody', { n: count })}</div>
        <div className="scheck-row">
          <button type="button" className={'sortkey f-mono' + (atypFirst ? ' on' : '')} onClick={onToggleSort}>{t('s3cScSort')} ↑</button>
          <span className="scheck-micro f-mono">{t('s3cScMicro')}</span>
        </div>
      </div>
      <button type="button" className="scheck-x" title={t('s3cScHide')} onClick={onHide}>✕</button>
    </div>
  );
}
