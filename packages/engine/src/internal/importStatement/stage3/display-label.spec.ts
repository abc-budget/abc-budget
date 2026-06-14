/**
 * display-label.spec.ts — Story 3.1 (EP-3): the ENT-006 display-label fallback.
 *
 * Fallback order: description → counterparty → bankCategory → String(mcc) → «—».
 * First NON-EMPTY (after trim) wins. No locale (VIS-003 — user content is not
 * translated; the helper returns raw field text or the em-dash).
 *
 * DERIVED-ON-READ ONLY: this never becomes a stored field and never enters the
 * footprint (HC-2/3, ENT-001) — it's a compute-on-read list helper.
 */

import { describe, it, expect } from 'vitest';
import { displayLabel } from './display-label';

const EMPTY = { description: null, counterparty: null, bankCategory: null, mcc: null };

describe('displayLabel — ENT-006 fallback chain', () => {
  it('description present → description wins', () => {
    expect(displayLabel({ ...EMPTY, description: 'Coffee', counterparty: 'Cafe', bankCategory: 'Food', mcc: 5814 })).toBe('Coffee');
  });

  it('description empty → counterparty wins', () => {
    expect(displayLabel({ ...EMPTY, description: '', counterparty: 'Cafe Alpha', bankCategory: 'Food', mcc: 5814 })).toBe('Cafe Alpha');
  });

  it('description whitespace-only → counterparty wins (trim counts as empty)', () => {
    expect(displayLabel({ ...EMPTY, description: '   ', counterparty: 'Cafe Alpha' })).toBe('Cafe Alpha');
  });

  it('description + counterparty empty → bankCategory wins', () => {
    expect(displayLabel({ ...EMPTY, description: null, counterparty: '', bankCategory: 'Groceries', mcc: 5814 })).toBe('Groceries');
  });

  it('only mcc present → String(mcc) wins', () => {
    expect(displayLabel({ ...EMPTY, mcc: 5814 })).toBe('5814');
  });

  it('mcc 0 is a present number → "0" wins over the em-dash', () => {
    expect(displayLabel({ ...EMPTY, mcc: 0 })).toBe('0');
  });

  it('all four empty/null → em-dash «—» (U+2014)', () => {
    expect(displayLabel(EMPTY)).toBe('—');
    expect(displayLabel({ description: '  ', counterparty: '', bankCategory: '   ', mcc: null })).toBe('—');
  });

  it('returns raw text verbatim — no locale/normalization (VIS-003)', () => {
    expect(displayLabel({ ...EMPTY, description: 'АТБ-Маркет №7  ' .trimEnd() })).toBe('АТБ-Маркет №7');
  });
});
