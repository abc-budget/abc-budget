import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConditionBuilder } from './ConditionBuilder';
import { LangProvider } from '../../../i18n/LangProvider';
import { FIELDS, cond } from './fixtures';
import type { ConditionDTO } from '@abc-budget/engine';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderBuilder(conditions: ConditionDTO[], onChange = vi.fn()) {
  const utils = render(
    <LangProvider initialLang="uk">
      <ConditionBuilder conditions={conditions} fields={FIELDS} onChange={onChange} lang="uk" />
    </LangProvider>,
  );
  return { ...utils, onChange };
}

describe('ConditionBuilder', () => {
  it('renders the builder shell with ALTUS condition classes (pixel-pass proxy)', () => {
    const { container } = renderBuilder([cond()]);
    expect(container.querySelector('.cond-builder')).toBeTruthy();
    expect(container.querySelector('.cond-row')).toBeTruthy();
  });

  it('amount condition surfaces the currency input AND the pairing note', () => {
    const { container } = renderBuilder([cond({ field: 'amount', operator: 'greaterThan', value: 100, currency: 'UAH' })]);
    expect(screen.getByTestId('amount-currency-row')).toBeTruthy();
    expect(container.querySelector('.cb-cur select')).toBeTruthy();
    expect(screen.getByTestId('currency-pair-note')).toBeTruthy();
  });

  it('non-amount conditions show neither the currency input nor the pairing note', () => {
    renderBuilder([cond({ field: 'description', operator: 'contains', value: 'X' })]);
    expect(screen.queryByTestId('amount-currency-row')).toBeNull();
    expect(screen.queryByTestId('currency-pair-note')).toBeNull();
  });

  it('changing the amount currency emits the updated ConditionDTO.currency', () => {
    const onChange = vi.fn();
    renderBuilder([cond({ field: 'amount', operator: 'greaterThan', value: 100, currency: 'UAH' })], onChange);
    fireEvent.change(screen.getByLabelText(/валюта/i), { target: { value: 'USD' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ field: 'amount', currency: 'USD' })]);
  });

  it('renders an AND divider between multiple conditions', () => {
    const { container } = renderBuilder([cond(), cond({ field: 'amount', operator: 'greaterThan', value: 50 })]);
    expect(container.querySelector('.cond-and')).toBeTruthy();
  });
});
