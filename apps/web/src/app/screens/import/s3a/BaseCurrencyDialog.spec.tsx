import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EngineClient } from '@abc-budget/engine';
import { localeToCurrency } from '@abc-budget/engine';
import { EngineClientProvider } from '../../../engine-client-context';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { BaseCurrencyDialog } from './BaseCurrencyDialog';

/**
 * BaseCurrencyDialog (Task 4, ENT-019; decision 3). The client arrives via
 * the provider seam (mock — the dialog only touches setBaseCurrency); the
 * localized names and the full ISO list are asserted against the SAME
 * platform APIs the component uses (Intl.DisplayNames /
 * Intl.supportedValuesOf), pinning the wiring, not the ICU data.
 */

const CURATED = ['UAH', 'USD', 'EUR', 'GBP', 'PLN', 'CHF', 'CZK', 'GEL'];
const SYMBOLS: Record<string, string> = {
  UAH: '₴', USD: '$', EUR: '€', GBP: '£', PLN: 'zł', CHF: '₣', CZK: 'Kč', GEL: '₾',
};

function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    setBaseCurrency: vi.fn(async () => undefined),
    ...over,
  } as unknown as EngineClient;
}

function renderDialog({
  client = makeClient(),
  lang = 'uk' as Lang,
  onDone = vi.fn(),
  onCancel = vi.fn(),
} = {}) {
  render(
    <LangProvider initialLang={lang}>
      <EngineClientProvider client={client}>
        <BaseCurrencyDialog onDone={onDone} onCancel={onCancel} />
      </EngineClientProvider>
    </LangProvider>,
  );
  return { client, onDone, onCancel };
}

const select = () => screen.getByTestId('s3a-basecur-select') as HTMLSelectElement;
const nameOf = (iso: string, lang: Lang) =>
  new Intl.DisplayNames([lang], { type: 'currency', fallback: 'code' }).of(iso) ?? iso;

function stubLocale(locale: string) {
  return vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(locale);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('BaseCurrencyDialog — render per the bundle (uk AND en)', () => {
  it('uk: title/body/label/autonote/keys resolve from the catalog', () => {
    renderDialog({ lang: 'uk' });
    expect(screen.getByRole('dialog', { name: 'Базова валюта' })).toBeTruthy();
    expect(screen.getByText('Базова валюта')).toBeTruthy();
    expect(
      screen.getByText(
        'Загальні підсумки бюджету рахуються в одній валюті. Ми визначили її автоматично — перевірте перед першим імпортом.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Валюта')).toBeTruthy();
    expect(
      screen.getByText(/ВИЗНАЧЕНО ЗА РЕГІОНОМ · ПОТІМ МОЖНА ЗМІНИТИ В НАЛАШТУВАННЯХ/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скасувати' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Далі ▸' })).toBeTruthy();
  });

  it('en: same surface in English', () => {
    renderDialog({ lang: 'en' });
    expect(screen.getByRole('dialog', { name: 'Base currency' })).toBeTruthy();
    expect(
      screen.getByText(
        'Overall budget totals are computed in one currency. We detected it automatically — confirm it before your first import.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Currency')).toBeTruthy();
    expect(screen.getByText(/DETECTED BY REGION · YOU CAN CHANGE IT LATER IN SETTINGS/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue ▸' })).toBeTruthy();
  });
});

describe('BaseCurrencyDialog — the two-optgroup list (decision 3)', () => {
  it('upper group = the curated 8 in prototype order, labeled SYM ISO · localized name', () => {
    renderDialog({ lang: 'uk' });
    const groups = select().querySelectorAll('optgroup');
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('Поширені');
    const options = [...groups[0].querySelectorAll('option')];
    expect(options.map((o) => o.value)).toEqual(CURATED);
    for (const o of options) {
      expect(o.textContent).toBe(`${SYMBOLS[o.value]}  ${o.value} · ${nameOf(o.value, 'uk')}`);
    }
  });

  it('lower group = the full reference minus the 8, sorted, ISO · localized name (no symbol)', () => {
    renderDialog({ lang: 'uk' });
    const lower = select().querySelectorAll('optgroup')[1];
    expect(lower.label).toBe('Усі валюти');
    const values = [...lower.querySelectorAll('option')].map((o) => o.value);
    const expected = Intl.supportedValuesOf('currency')
      .filter((iso) => !CURATED.includes(iso))
      .sort();
    expect(values).toEqual(expected);
    const jpy = lower.querySelector('option[value="JPY"]')!;
    expect(jpy.textContent).toBe(`JPY · ${nameOf('JPY', 'uk')}`);
  });

  it('localized names follow the language for BOTH groups (en render)', () => {
    renderDialog({ lang: 'en' });
    const groups = select().querySelectorAll('optgroup');
    expect(groups[0].label).toBe('Common');
    expect(groups[1].label).toBe('All currencies');
    expect(groups[0].querySelector('option[value="UAH"]')!.textContent).toBe(
      `₴  UAH · ${nameOf('UAH', 'en')}`,
    );
    expect(groups[1].querySelector('option[value="JPY"]')!.textContent).toBe(
      `JPY · ${nameOf('JPY', 'en')}`,
    );
  });
});

describe('BaseCurrencyDialog — preselect = localeToCurrency(navigator.language) ?? USD', () => {
  it('uk-UA → UAH (curated group)', () => {
    stubLocale('uk-UA');
    renderDialog();
    expect(select().value).toBe('UAH');
  });

  it('en-US → USD', () => {
    stubLocale('en-US');
    renderDialog();
    expect(select().value).toBe('USD');
  });

  it('unmapped locale → the USD fallback', () => {
    stubLocale('xx-XX');
    expect(localeToCurrency('xx-XX')).toBeUndefined(); // really unmapped
    renderDialog();
    expect(select().value).toBe('USD');
  });

  it('sv-SE → SEK via the REAL localeToCurrency, preselected in the LOWER optgroup', () => {
    expect(localeToCurrency('sv-SE')).toBe('SEK'); // the real mapping, outside the curated 8
    stubLocale('sv-SE');
    renderDialog();
    expect(select().value).toBe('SEK');
    const opt = select().querySelector('option[value="SEK"]')!;
    expect((opt.closest('optgroup') as HTMLOptGroupElement).label).toBe('Усі валюти');
  });
});

describe('BaseCurrencyDialog — confirm / cancel / loud invalid-set (HC-7)', () => {
  it('confirm → client.setBaseCurrency(selected iso) → onDone', async () => {
    stubLocale('en-US');
    const { client, onDone } = renderDialog();
    fireEvent.change(select(), { target: { value: 'PLN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далі ▸' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(client.setBaseCurrency).toHaveBeenCalledExactlyOnceWith('PLN');
  });

  it('cancel key → onCancel; nothing persisted', () => {
    const { client, onDone, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    expect(client.setBaseCurrency).not.toHaveBeenCalled();
  });

  it('scrim click → onCancel; modal click does NOT (prototype stopPropagation)', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByText('Базова валюта'));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('s3a-basecur'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('set rejection (InvalidBaseCurrencyError-shaped) → LOUD inline error, dialog stays, no silent close', async () => {
    const err = Object.assign(new Error('XYZ is not a known ISO-4217 currency'), {
      name: 'InvalidBaseCurrencyError',
    });
    const client = makeClient({ setBaseCurrency: vi.fn(async () => Promise.reject(err)) });
    const { onDone, onCancel } = renderDialog({ client });
    fireEvent.click(screen.getByRole('button', { name: 'Далі ▸' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не вдалося зберегти валюту');
    expect(alert.textContent).toContain('XYZ is not a known ISO-4217 currency');
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Базова валюта' })).toBeTruthy(); // still open
    // the key re-arms — the user can fix the pick and try again
    expect((screen.getByRole('button', { name: 'Далі ▸' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
