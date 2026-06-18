import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TypicalityReasonDTO } from '@abc-budget/engine';
import { LangProvider } from '../../../i18n/LangProvider';
import { AtypReasons } from './AtypReasons';
afterEach(cleanup);
const r = (reasons: TypicalityReasonDTO[]) =>
  render(<LangProvider initialLang="uk"><AtypReasons reasons={reasons} lang="uk" /></LangProvider>);

describe('AtypReasons', () => {
  it('mcc categorical → «MCC ≠ НАБІР · ‹title›» (via mccTitle, not the raw code)', () => {
    r([{ field: 'mcc', kind: 'categorical-minority', value: 5813 }]);
    expect(screen.getByText(/MCC ≠ НАБІР/)).toBeTruthy();
    expect(screen.queryByText('5813')).toBeNull();   // resolved to a title, not the raw code
  });
  it('non-mcc categorical (counterparty) → «‹value› ≠ НАБІР»', () => {
    r([{ field: 'counterparty', kind: 'categorical-minority', value: 'ALIEXPRESS' }]);
    expect(screen.getByText(/ALIEXPRESS/)).toBeTruthy();
    expect(screen.getByText(/≠ НАБІР/)).toBeTruthy();
  });
  it('amount-outlier → «СУМА — ВИКИД · ×N»', () => {
    r([{ field: 'amount', kind: 'amount-outlier', magnitude: 4 }]);
    expect(screen.getByText(/СУМА — ВИКИД/)).toBeTruthy();
    expect(screen.getByText(/×4/)).toBeTruthy();
  });
  it('rare-tokens → «РІДКІСНІ СЛОВА · «token»»', () => {
    r([{ field: 'description', kind: 'rare-tokens', tokens: ['КАЗИНО'] }]);
    expect(screen.getByText(/РІДКІСНІ СЛОВА/)).toBeTruthy();
    expect(screen.getByText(/КАЗИНО/)).toBeTruthy();
  });
});
