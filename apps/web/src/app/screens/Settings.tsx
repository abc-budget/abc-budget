import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Key, Panel, PanelBody, PanelHeader, SectionTabs } from '../../ui/altus/components';
import { DwellHeader } from '../headers';

const TABS = [
  { id: 'overview', label: 'Огляд' },
  { id: 'categories', label: 'Категорії' },
];

/** Settings placeholder — real panels: EP-5/EP-6. In-page tabs per FEAT-030. */
export function Settings() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  return (
    <div className="shell" data-testid="screen-settings">
      <DwellHeader activeZone="settings" />
      <main className="screen-body">
        <SectionTabs tabs={TABS} activeId={tab} onSelect={setTab} />
        {tab === 'overview' ? (
          <Panel screws>
            <PanelHeader logchip="DAT" title="Дані" />
            <PanelBody>
              <p className="body-p">Базова валюта, мова, поріг — у наступних сторіз.</p>
              <Key variant="green" sm onClick={() => navigate('/import')}>Імпорт виписки</Key>
            </PanelBody>
          </Panel>
        ) : (
          <div data-testid="tab-categories">
            <Panel screws>
              <PanelHeader logchip="CAT" title="Категорії" />
              <PanelBody>
                <p className="body-p">Керування категоріями — EP-5.</p>
              </PanelBody>
            </Panel>
          </div>
        )}
      </main>
    </div>
  );
}
