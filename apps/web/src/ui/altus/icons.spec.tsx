import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CatIcon, ICON_GROUPS, ICON_META, ICON_ORDER, ICONS, iconName } from './icons';

describe('ALTUS icon module integrity', () => {
  it('has 8 groups and 52 glyphs with unique ids', () => {
    expect(ICON_GROUPS).toHaveLength(8);
    expect(ICON_ORDER.length).toBe(52);
    expect(new Set(ICON_ORDER).size).toBe(52);
    expect(Object.keys(ICONS)).toHaveLength(52);
  });

  it('every glyph has uk + en names and a valid group id', () => {
    const groupIds = new Set(ICON_GROUPS.map((g) => g.id));
    for (const id of ICON_ORDER) {
      const meta = ICON_META[id];
      expect(meta.uk.length, id).toBeGreaterThan(0);
      expect(meta.en.length, id).toBeGreaterThan(0);
      expect(groupIds.has(meta.group), id).toBe(true);
    }
  });

  it('iconName resolves per language and falls back to id', () => {
    expect(iconName('coffee', 'uk')).toBe('Кава');
    expect(iconName('coffee', 'en')).toBe('Coffee');
    expect(iconName('nope', 'en')).toBe('nope');
  });

  it('CatIcon renders a 24×24-viewBox svg at the requested size and falls back to "other"', () => {
    const { container } = render(<CatIcon id="groceries" size={16} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('16');
    const fallback = render(<CatIcon id="does-not-exist" />).container.querySelector('svg')!;
    expect(fallback.innerHTML.length).toBeGreaterThan(0); // 'other' glyph rendered
  });
});
