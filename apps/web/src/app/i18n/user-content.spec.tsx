import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { LangProvider, useLang, useT } from './LangProvider';

/** Simulates a future screen: chrome via t(), user content as raw state — never translated. */
function Fixture() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [name, setName] = useState('Мої продукти');
  return (
    <div>
      <h1>{t('setCatTitle')}</h1>
      <input aria-label="category-name" value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={() => setLang(lang === 'uk' ? 'en' : 'uk')}>switch</button>
    </div>
  );
}

describe('HC-6/VIS-003 — user content never translated', () => {
  it('toggling language never alters typed user content; chrome translates around it', () => {
    render(
      <LangProvider initialLang="uk">
        <Fixture />
      </LangProvider>,
    );
    const input = screen.getByLabelText('category-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Мої продукти & кава ☕' } });
    expect(screen.getByRole('heading').textContent).toBe('Категорії');

    fireEvent.click(screen.getByText('switch'));
    expect(screen.getByRole('heading').textContent).toBe('Categories'); // chrome translated
    expect(input.value).toBe('Мої продукти & кава ☕'); // user content byte-identical

    fireEvent.click(screen.getByText('switch'));
    expect(input.value).toBe('Мої продукти & кава ☕');
  });
});
