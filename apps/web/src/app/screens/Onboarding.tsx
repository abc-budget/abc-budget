import { useNavigate } from 'react-router';
import { Key, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { OnboardingHeader } from '../headers';

/** First-run screen (root, no own URL). Real content: the onboarding epic. */
export function Onboarding() {
  const navigate = useNavigate();
  return (
    <div className="shell" data-testid="screen-onboarding">
      <OnboardingHeader />
      <main className="screen-body">
        <Panel screws>
          <PanelHeader logchip="OB" title="Ласкаво просимо" />
          <PanelBody>
            <p className="body-p">Перший запуск. Імпортуйте виписку, щоб почати.</p>
            <div style={{ display: 'flex', gap: 'var(--sp-m)', flexWrap: 'wrap' }}>
              <Key variant="gold" onClick={() => navigate('/import')}>Імпортувати виписку</Key>
              <Key variant="beige" onClick={() => navigate('/import')}>Спробувати на прикладі</Key>
            </div>
          </PanelBody>
        </Panel>
      </main>
    </div>
  );
}
