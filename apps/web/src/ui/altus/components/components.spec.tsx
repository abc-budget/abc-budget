import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Key } from './Key';
import { Lamp } from './Lamp';
import { StateBadge, BADGE_STATES } from './StateBadge';
import { Chip } from './Chip';
import { CodeChip } from './CodeChip';

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
