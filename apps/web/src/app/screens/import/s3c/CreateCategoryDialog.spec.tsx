/**
 * CreateCategoryDialog.spec.tsx — the follow-base create path must send the
 * engine's EXACT currency alias `'base'` (lowercase = BASE_CURRENCY_ALIAS, 4.3a),
 * NOT the prototype's `'BASE'` (which throws InvalidCategoryError: Invalid
 * currency: BASE). FINDING-1 of the 4.9b real-data QA.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CreateCategoryDialog } from './CreateCategoryDialog';
import { LangProvider } from '../../../i18n/LangProvider';

afterEach(() => {
  cleanup();
});

function renderDialog(onCreate = vi.fn()) {
  render(
    <LangProvider initialLang="uk">
      <CreateCategoryDialog initialName="Аптека" onCreate={onCreate} onCancel={() => {}} lang="uk" />
    </LangProvider>,
  );
  return onCreate;
}

describe('CreateCategoryDialog — follow-base currency', () => {
  it('defaults to the follow-base option and creates with currency "base" (the engine alias)', () => {
    const onCreate = renderDialog();
    fireEvent.click(screen.getByText('Створити'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0]).toMatchObject({ name: 'Аптека', currency: 'base' });
    // never the uppercase prototype value the engine rejects
    expect(onCreate.mock.calls[0][0].currency).not.toBe('BASE');
  });

  it('still sends a concrete ISO when one is picked', () => {
    const onCreate = renderDialog();
    fireEvent.change(screen.getByLabelText('Валюта категорії'), { target: { value: 'USD' } });
    fireEvent.click(screen.getByText('Створити'));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ currency: 'USD' });
  });
});
