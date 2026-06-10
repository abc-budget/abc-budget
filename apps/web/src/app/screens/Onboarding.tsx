import { useNavigate } from 'react-router';
import { Key, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { OnboardingHeader } from '../headers';
import { useT } from '../i18n/LangProvider';

/** First-run screen (root, no own URL). Real content: the onboarding epic. */
export function Onboarding() {
  const navigate = useNavigate();
  const t = useT();
  return (
    <div className="shell" data-testid="screen-onboarding">
      <OnboardingHeader />
      <main className="screen-body">
        <Panel screws>
          <PanelHeader logchip="OB" title={t('obTitle')} />
          <PanelBody>
            <p className="body-p">{t('obLead')}</p>
            <div style={{ display: 'flex', gap: 'var(--sp-m)', flexWrap: 'wrap' }}>
              <Key variant="gold" onClick={() => navigate('/import')}>{t('ctaImportStatement')}</Key>
              <Key variant="beige" onClick={() => navigate('/import')}>{t('ctaTryExample')}</Key>
            </div>
          </PanelBody>
        </Panel>
      </main>
    </div>
  );
}
