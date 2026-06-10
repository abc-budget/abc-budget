import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Key, Panel, PanelBody, PanelHeader, SectionTabs } from '../../ui/altus/components';
import { DwellHeader } from '../headers';
import { useT } from '../i18n/LangProvider';

/** Settings placeholder — real panels: EP-5/EP-6. In-page tabs per FEAT-030. */
export function Settings() {
  const navigate = useNavigate();
  const t = useT();
  const tabs = [
    { id: 'overview', label: t('setTabOverview') },
    { id: 'categories', label: t('setTabCategories') },
  ];
  const [tab, setTab] = useState('overview');
  return (
    <div className="shell" data-testid="screen-settings">
      <DwellHeader activeZone="settings" />
      <main className="screen-body">
        <SectionTabs tabs={tabs} activeId={tab} onSelect={setTab} />
        {tab === 'overview' ? (
          <Panel screws>
            <PanelHeader logchip="DAT" title={t('setDataTitle')} />
            <PanelBody>
              <p className="body-p">{t('setDataLead')}</p>
              <Key variant="green" sm onClick={() => navigate('/import')}>{t('ctaImport')}</Key>
            </PanelBody>
          </Panel>
        ) : (
          <div data-testid="tab-categories">
            <Panel screws>
              <PanelHeader logchip="CAT" title={t('setCatTitle')} />
              <PanelBody>
                <p className="body-p">{t('setCatLead')}</p>
              </PanelBody>
            </Panel>
          </div>
        )}
      </main>
    </div>
  );
}
