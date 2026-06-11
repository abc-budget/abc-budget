import { describe, it, expect } from 'vitest';
import { decodeBytes, cyrillicRatio } from './encoding';

// ---------------------------------------------------------------------------
// Helper: verify bytes round-trip through the module's own logic; self-consistent
// because the test constructs bytes and asserts the decoded STRING — no external
// table dependency.
// ---------------------------------------------------------------------------

describe('cyrillicRatio (pure unit)', () => {
  it('returns 1 for all-Cyrillic text', () => {
    expect(cyrillicRatio('Дата')).toBe(1);
  });

  it('returns 0 for pure ASCII letters', () => {
    expect(cyrillicRatio('hello world')).toBe(0);
  });

  it('returns 0 for text with no letters at all', () => {
    expect(cyrillicRatio('123;,.')).toBe(0);
  });

  it('returns fraction for mixed text', () => {
    // 'aД' — 1 Cyrillic out of 2 letters
    expect(cyrillicRatio('aД')).toBeCloseTo(0.5);
  });
});

describe('decodeBytes', () => {
  // -------------------------------------------------------------------------
  // UTF-8 cases
  // -------------------------------------------------------------------------

  it('plain ASCII → utf-8, bom false, ambiguous false', () => {
    const text = 'date,amount,description';
    const bytes = new TextEncoder().encode(text).buffer;
    const result = decodeBytes(bytes);
    expect(result.text).toBe(text);
    expect(result.encoding).toBe('utf-8');
    expect(result.bom).toBe(false);
    expect(result.ambiguous).toBe(false);
  });

  it('UTF-8 with BOM → BOM stripped, bom true, encoding utf-8', () => {
    const payload = new TextEncoder().encode('hello');
    const withBom = new Uint8Array([0xEF, 0xBB, 0xBF, ...payload]);
    const result = decodeBytes(withBom.buffer);
    expect(result.text).toBe('hello');
    expect(result.encoding).toBe('utf-8');
    expect(result.bom).toBe(true);
    expect(result.ambiguous).toBe(false);
  });

  it('valid multi-byte UTF-8 «Дата» (D0 94 D0 B0 D1 82 D0 B0) → utf-8', () => {
    // UTF-8 encoding of Д=U+0414, а=U+0430, т=U+0442, а=U+0430
    const bytes = new Uint8Array([0xD0, 0x94, 0xD0, 0xB0, 0xD1, 0x82, 0xD0, 0xB0]);
    const result = decodeBytes(bytes.buffer);
    expect(result.text).toBe('Дата');
    expect(result.encoding).toBe('utf-8');
    expect(result.bom).toBe(false);
    expect(result.ambiguous).toBe(false);
  });

  // -------------------------------------------------------------------------
  // cp1251 cases
  // -------------------------------------------------------------------------

  it('cp1251 «Дата» (C4 E0 F2 E0) — INVALID utf-8 → decoded via windows-1251', () => {
    // These bytes are invalid UTF-8 — 0xC4 starts a 2-byte sequence but 0xE0 is
    // not a valid continuation byte; strict TextDecoder('utf-8', {fatal:true}) will throw.
    // windows-1251: Д=0xC4, а=0xE0, т=0xF2, а=0xE0
    const bytes = new Uint8Array([0xC4, 0xE0, 0xF2, 0xE0]);
    const result = decodeBytes(bytes.buffer);
    // Self-consistent: assert the string that windows-1251 produces for these bytes
    expect(result.text).toBe(new TextDecoder('windows-1251').decode(bytes));
    expect(result.text).toBe('Дата');
    expect(result.encoding).toBe('windows-1251');
    expect(result.bom).toBe(false);
    expect(result.ambiguous).toBe(false); // 100% Cyrillic → NOT ambiguous
  });

  it('cp1251 full Ukrainian header «Дата операції;Сума;Опис» round-trips', () => {
    // windows-1251 bytes (verified via Node TextDecoder):
    //   Д=C4 а=E0 т=F2 а=E0 ' '=20
    //   о=EE п=EF е=E5 р=F0 а=E0 ц=F6 і=B3 ї=BF
    //   ;=3B
    //   С=D1 у=F3 м=EC а=E0
    //   ;=3B
    //   О=CE п=EF и=E8 с=F1
    const bytes = new Uint8Array([
      0xC4, 0xE0, 0xF2, 0xE0, 0x20,
      0xEE, 0xEF, 0xE5, 0xF0, 0xE0, 0xF6, 0xB3, 0xBF,
      0x3B,
      0xD1, 0xF3, 0xEC, 0xE0,
      0x3B,
      0xCE, 0xEF, 0xE8, 0xF1,
    ]);
    const expected = new TextDecoder('windows-1251').decode(bytes);
    const result = decodeBytes(bytes.buffer);
    expect(result.text).toBe(expected);
    expect(result.text).toBe('Дата операції;Сума;Опис');
    expect(result.encoding).toBe('windows-1251');
    expect(result.ambiguous).toBe(false); // mostly Cyrillic
  });

  // -------------------------------------------------------------------------
  // Ambiguous cases
  // -------------------------------------------------------------------------

  it('ambiguous pure-ASCII → utf-8, ambiguous false (ASCII is valid utf-8)', () => {
    // Pure ASCII decodes fine as utf-8; no cp1251 fallback needed → not ambiguous
    const bytes = new TextEncoder().encode('2023-01-15,100.00,payment');
    const result = decodeBytes(bytes.buffer);
    expect(result.encoding).toBe('utf-8');
    expect(result.ambiguous).toBe(false);
  });

  it('bytes invalid in UTF-8 but cp1251-decoded text is <1% Cyrillic → windows-1251 + ambiguous true', () => {
    // cp1251 0x88 = U+20AC (€ sign) — not a Cyrillic letter, not an ASCII letter.
    // 0x88 alone is invalid UTF-8 (not a valid lead byte, not ASCII).
    // Filling 100 bytes with 0x88: strict UTF-8 decode throws; cp1251 decode gives "€€€…"
    // cyrillicRatio("€€€…") = 0 / 0 = 0 (no letters) → 0 < 0.01 → ambiguous: true.
    const bytes = new Uint8Array(100);
    bytes.fill(0x88); // invalid UTF-8; cp1251 → € (non-letter, 0% Cyrillic)
    const result = decodeBytes(bytes.buffer);
    expect(result.encoding).toBe('windows-1251');
    expect(result.ambiguous).toBe(true);
  });
});
