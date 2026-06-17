import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpsPanel } from './OpsPanel';
import { LangToggle } from '../../../../ui/altus/components/LangToggle';
import { LangProvider, useLang } from '../../../i18n/LangProvider';
import { cat, categoryMap, row, FIELDS } from './fixtures';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Harness wiring the ALTUS LangToggle to the provider — like the screen does. */
function Harness() {
  const { lang, setLang } = useLang();
  return (
    <>
      <LangToggle lang={lang} onChange={setLang} />
      <OpsPanel
        rows={[row({ description: 'АТБ МАРКЕТ' })]}
        fields={FIELDS}
        categories={categoryMap(cat())}
        total={1}
        matchCount={1}
        segment="all"
        onSegment={() => {}}
        page={0}
        onPage={() => {}}
        draft={[]}
        onAddCondition={() => {}}
        onCellClick={() => {}}
        lang={lang}
      />
    </>
  );
}

describe('LangToggle flips chrome but not operation content (HC-6)', () => {
  it('a chrome string translates while the operation description stays verbatim', () => {
    render(
      <LangProvider initialLang="uk">
        <Harness />
      </LangProvider>,
    );

    // chrome: the segment label is Ukrainian
    expect(screen.getByText('Усі')).toBeTruthy();
    expect(screen.queryByText('All')).toBeNull();
    // content: the description is present and is user data
    expect(screen.getByText('АТБ МАРКЕТ')).toBeTruthy();

    // flip to EN
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));

    // chrome flipped
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.queryByText('Усі')).toBeNull();
    // content did NOT translate — still the exact source string
    expect(screen.getByText('АТБ МАРКЕТ')).toBeTruthy();
  });
});
