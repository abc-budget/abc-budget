import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { TypeGlyph, glyphKeyFor } from './TypeGlyph';

afterEach(cleanup);

describe('glyphKeyFor (engine definition → bundle glyph key)', () => {
  it('maps the four snake_case definitions to short bundle keys', () => {
    expect(glyphKeyFor('bank_account')).toBe('account');
    expect(glyphKeyFor('merchant_category')).toBe('mcc');
    expect(glyphKeyFor('exchange_rate')).toBe('rate');
    expect(glyphKeyFor('bank_commission')).toBe('commission');
  });

  it('passes through the direct 1:1 definitions', () => {
    for (const d of [
      'date',
      'amount',
      'description',
      'currency',
      'balance',
      'status',
      'category',
      'cashback',
      'time',
      'counterparty',
      'ignore',
    ]) {
      expect(glyphKeyFor(d)).toBe(d);
    }
  });

  it('returns undefined for unknown definitions', () => {
    expect(glyphKeyFor('unknown')).toBeUndefined();
    expect(glyphKeyFor('nonsense')).toBeUndefined();
  });
});

describe('TypeGlyph', () => {
  it('renders an svg with stroked paths for a bundle key', () => {
    const { container } = render(<TypeGlyph name="account" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-glyph')).toBe('account');
    expect(svg?.querySelector('g')).toBeTruthy();
  });

  it('accepts an engine definition string too (bank_account → account glyph)', () => {
    const { container } = render(<TypeGlyph name="bank_account" />);
    expect(container.querySelector('svg')?.getAttribute('data-glyph')).toBe('account');
  });

  it('honors the size prop', () => {
    const { container } = render(<TypeGlyph name="date" size={20} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('height')).toBe('20');
  });

  it('renders an empty (no-glyph) svg for an unknown name', () => {
    const { container } = render(<TypeGlyph name="nope" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('data-glyph')).toBe('none');
    expect(svg?.querySelector('g')).toBeNull();
  });
});
