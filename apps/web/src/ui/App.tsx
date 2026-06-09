import { useEffect, useState } from 'react';
import { engine } from '../engine';

export function App() {
  const [pong, setPong] = useState('…');
  const [version, setVersion] = useState('…');

  useEffect(() => {
    void engine.ping('hello').then(setPong);
    void engine
      .getVersion()
      .then((v) => setVersion(`engine ${v.engine} · contract ${v.contract}`));
  }, []);

  return (
    <main>
      <h1>ABC Budget</h1>
      <p data-testid="pong">ping → {pong}</p>
      <p data-testid="version">{version}</p>
    </main>
  );
}
