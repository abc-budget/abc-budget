import type { ReactNode } from 'react';
import { Lamp } from './Lamp';
import type { LampTone } from './Lamp';

/** Screw positions for the console look (prototype places them at panel corners). */
const SCREW_POSITIONS = [
  { top: 7, left: 7 }, { top: 7, right: 7 }, { bottom: 7, left: 7 }, { bottom: 7, right: 7 },
] as const;

export function Panel({ screws, className, children }: { screws?: boolean; className?: string; children: ReactNode }) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {screws && SCREW_POSITIONS.map((pos, i) => <span key={i} className="screw" aria-hidden="true" style={pos} />)}
      {children}
    </section>
  );
}

export function PanelHeader({ lamp, logchip, title, children }: { lamp?: LampTone; logchip?: string; title?: string; children?: ReactNode }) {
  return (
    <header className="panel-h">
      <div className="lhs">
        {lamp && <Lamp tone={lamp} />}
        {logchip && <span className="logchip">{logchip}</span>}
        {title && <h3>{title}</h3>}
      </div>
      {children}
    </header>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="panel-b">{children}</div>;
}
