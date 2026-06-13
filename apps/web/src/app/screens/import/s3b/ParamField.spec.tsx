import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ParamField } from './ParamField';
import { PARAM_SCHEMA } from './param-schema';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import type { UiValues } from './param-schema';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const CURRENCY_FIELD = PARAM_SCHEMA.amount[0]; // the shared CURRENCY_FIELD
const STATUS_FIELD = PARAM_SCHEMA.status[0]; // has a 'select' custom (useValue)

function renderField(field = CURRENCY_FIELD, values: UiValues = {}, lang: Lang = 'uk', distinct?: string[]) {
  const onChange = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <ParamField field={field} value={values} onChange={onChange} distinct={distinct} />
    </LangProvider>,
  );
  return { ...utils, onChange };
}

describe('ParamField (seg radio + custom sub-control)', () => {
  it('renders a radiogroup with one radio per option', () => {
    const { container } = renderField();
    expect(container.querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(container.querySelectorAll('.seg-btn[role="radio"]')).toHaveLength(CURRENCY_FIELD.options.length);
  });

  it('marks the current option aria-checked + on', () => {
    const { container } = renderField(CURRENCY_FIELD, { currency: 'use_base' });
    const checked = container.querySelector('.seg-btn[aria-checked="true"]')!;
    expect(checked.classList.contains('on')).toBe(true);
    expect(checked.textContent).toBe('Базова валюта');
  });

  it('clicking an option fires onChange(fieldKey, val)', () => {
    const { container, onChange } = renderField();
    fireEvent.click(container.querySelectorAll('.seg-btn')[1]);
    expect(onChange).toHaveBeenCalledWith('currency', 'use_base');
  });

  it('shows the text custom sub-control when the custom option is active (currency=code)', () => {
    const { container } = renderField(CURRENCY_FIELD, { currency: 'code' });
    const input = container.querySelector('.cfg-custom input')!;
    expect(input).toBeTruthy();
    expect(input.getAttribute('placeholder')).toBe('USD');
  });

  it('typing in the custom text input fires onChange(`${key}Custom`, value)', () => {
    const { container, onChange } = renderField(CURRENCY_FIELD, { currency: 'code' });
    fireEvent.change(container.querySelector('.cfg-custom input')!, { target: { value: 'EUR' } });
    expect(onChange).toHaveBeenCalledWith('currencyCustom', 'EUR');
  });

  it('renders the select custom as distinct-value radios (status=useValue)', () => {
    const { container, onChange } = renderField(
      STATUS_FIELD,
      { successValue: 'useValue' },
      'uk',
      ['completed', 'pending'],
    );
    const customRadios = container.querySelectorAll('.cfg-custom .seg-btn');
    expect(customRadios).toHaveLength(2);
    fireEvent.click(customRadios[0]);
    expect(onChange).toHaveBeenCalledWith('successValueCustom', 'completed');
  });

  it('shows the option hint when present (amount type field)', () => {
    const typeField = PARAM_SCHEMA.amount[1];
    renderField(typeField, { type: 'income' }, 'en');
    expect(screen.getByText('all positive · ABC doesn’t count income yet')).toBeTruthy();
  });
});
