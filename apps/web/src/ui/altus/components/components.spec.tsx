import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Key } from './Key';
import { Lamp } from './Lamp';
import { StateBadge, BADGE_STATES } from './StateBadge';
import { Chip } from './Chip';
import { CodeChip } from './CodeChip';
import { Panel, PanelBody, PanelHeader } from './Panel';
import { Cream, Crt, Paper } from './surfaces';
import { Gauge } from './Gauge';
import { BrandMark } from './BrandMark';

describe('Key', () => {
  it('renders a button with the variant + base classes', () => {
    render(<Key variant="gold">Зберегти</Key>);
    const btn = screen.getByRole('button', { name: 'Зберегти' });
    expect(btn.className).toBe('key gold');
  });
  it('supports sm and pressed modifiers and an icon slot', () => {
    const { container } = render(
      <Key variant="green" sm pressed icon={<svg data-testid="ic" />}>Далі</Key>,
    );
    const btn = container.querySelector('button')!;
    expect(btn.className).toBe('key green sm pressed');
    expect(btn.querySelector('[data-testid="ic"]')).not.toBeNull();
  });
});

describe('Lamp', () => {
  it('renders the tone class and is aria-hidden (decorative — pair with a word)', () => {
    const { container } = render(<Lamp tone="green" />);
    const lamp = container.firstElementChild!;
    expect(lamp.className).toBe('lamp green');
    expect(lamp.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('StateBadge — §4: never colour alone', () => {
  it('every state renders an svg icon AND a non-empty label', () => {
    for (const state of BADGE_STATES) {
      const { container, unmount } = render(<StateBadge state={state} label={`L-${state}`} />);
      expect(container.querySelector('svg'), state).not.toBeNull();
      expect(container.textContent, state).toContain(`L-${state}`);
      unmount();
    }
  });
  it('history reuses the muted badge class (per prototype STATE_META)', () => {
    const { container } = render(<StateBadge state="history" label="Історія" />);
    expect(container.firstElementChild!.className).toBe('badge muted');
  });
  it('appends extra text after a separator', () => {
    const { container } = render(<StateBadge state="over" label="ПЕРЕВИЩЕНО" extra="+12%" />);
    expect(container.textContent).toBe('ПЕРЕВИЩЕНО · +12%');
  });
});

describe('Chip / CodeChip', () => {
  it('Chip is a button with the chip class', () => {
    render(<Chip>Очистити</Chip>);
    expect(screen.getByRole('button', { name: 'Очистити' }).className).toBe('chip');
  });
  it('CodeChip renders mono code text', () => {
    const { container } = render(<CodeChip>UAH</CodeChip>);
    expect(container.firstElementChild!.className).toBe('codechip');
    expect(container.textContent).toBe('UAH');
  });
});

describe('Panel family', () => {
  it('renders panel > header(+logchip, title) + body, with 4 screws when requested', () => {
    const { container } = render(
      <Panel screws>
        <PanelHeader logchip="DAT-01" title="Бюджет" />
        <PanelBody>вміст</PanelBody>
      </Panel>,
    );
    const panel = container.firstElementChild!;
    expect(panel.classList.contains('panel')).toBe(true);
    expect(panel.querySelectorAll('.screw')).toHaveLength(4);
    expect(panel.querySelector('.logchip')!.textContent).toBe('DAT-01');
    expect(panel.querySelector('h3')!.textContent).toBe('Бюджет');
    expect(panel.querySelector('.panel-b')!.textContent).toBe('вміст');
  });
});

describe('surfaces', () => {
  it('Cream/Crt/Paper apply their classes', () => {
    expect(render(<Cream>x</Cream>).container.firstElementChild!.classList.contains('cream')).toBe(true);
    expect(render(<Crt>x</Crt>).container.firstElementChild!.classList.contains('crt')).toBe(true);
    expect(render(<Paper>x</Paper>).container.firstElementChild!.classList.contains('paper')).toBe(true);
  });
});

describe('Gauge — dot-matrix math (28 cells)', () => {
  const lit = (c: HTMLElement) => c.querySelectorAll('.cell[style]').length;
  it('lights round(ratio*28) cells, capped at 28', () => {
    expect(lit(render(<Gauge spent={0} budget={100} state="within" />).container)).toBe(0);
    expect(lit(render(<Gauge spent={50} budget={100} state="within" />).container)).toBe(14);
    expect(lit(render(<Gauge spent={100} budget={100} state="within" />).container)).toBe(28);
    expect(lit(render(<Gauge spent={150} budget={100} state="over" />).container)).toBe(28);
  });
  it('shows the percentage and an over-limit row past 100%', () => {
    const { container } = render(
      <Gauge spent={150} budget={100} state="over" overLimitLabel="понад ліміт" />,
    );
    expect(container.querySelector('.pctnum')!.textContent).toBe('150%');
    expect(container.querySelector('.ovr-pct')!.textContent).toBe('+50% понад ліміт');
  });
  it('archived: no lit cells, em-dash percent', () => {
    const { container } = render(<Gauge spent={50} budget={100} state="within" archived />);
    expect(lit(container)).toBe(0);
    expect(container.querySelector('.pctnum')!.textContent).toBe('—');
  });
});

describe('BrandMark', () => {
  it('links to href when given', () => {
    const { container } = render(<BrandMark href="/" />);
    const a = container.querySelector('a.brand')!;
    expect(a.getAttribute('href')).toBe('/');
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/assets/abc-flap-mark.svg');
    expect(container.textContent).toContain('ABC');
  });
  it('is inert (no anchor) without href — FEAT-030 Onboarding rule', () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('.brand')).not.toBeNull();
  });
});
