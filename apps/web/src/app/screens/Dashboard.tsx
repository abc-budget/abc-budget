import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Crt, Key, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { engine } from '../../engine';
import { DwellHeader } from '../headers';

/** Dashboard placeholder — real content: EP-6/EP-7. Hosts the 1.1 engine slice. */
export function Dashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('…');
  useEffect(() => {
    void Promise.all([engine.ping('ok'), engine.getVersion()]).then(([pong, v]) =>
      setStatus(`ENGINE ${v.engine} · CONTRACT ${v.contract} · PING ${pong.toUpperCase()}`),
    );
  }, []);
  return (
    <div className="shell" data-testid="screen-dashboard">
      <DwellHeader activeZone="dashboard" />
      <main className="screen-body">
        <Panel screws>
          <PanelHeader logchip="DSH" title="Дашборд" />
          <PanelBody>
            <p className="body-p">Бюджет з'явиться тут (EP-6). Поки що — імпортуйте виписку.</p>
            <Key variant="green" onClick={() => navigate('/import')}>Імпорт виписки</Key>
          </PanelBody>
        </Panel>
        <Crt data-testid="engine-status">{status}</Crt>
      </main>
    </div>
  );
}
