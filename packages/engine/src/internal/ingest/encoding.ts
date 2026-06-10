/**
 * Byte-level encoding detection for ingest.
 *
 * Strategy:
 *   1. BOM check — strip EF BB BF prefix → always utf-8.
 *   2. Strict TextDecoder('utf-8', {fatal:true}) attempt.
 *   3. On failure → TextDecoder('windows-1251') fallback (every byte is mapped).
 *   4. `ambiguous` flag: true only when the cp1251 path produces <1% Cyrillic
 *      among all letter characters (heuristic sanity score).
 *
 * `cyrillicRatio` is exported as a pure function so it can be unit-tested in
 * isolation without touching ArrayBuffer logic.
 */

export interface DecodeByteResult {
  text: string;
  encoding: 'utf-8' | 'windows-1251';
  bom: boolean;
  ambiguous: boolean;
}

const UTF8_BOM = [0xEF, 0xBB, 0xBF] as const;

/**
 * Returns the fraction of letter code-points in `text` that fall in the
 * Cyrillic Unicode block (U+0400–U+04FF).
 *
 * Returns 0 when there are no letter characters at all.
 */
export function cyrillicRatio(text: string): number {
  let letters = 0;
  let cyrillic = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    // ASCII letters
    if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) {
      letters++;
    }
    // Cyrillic block U+0400–U+04FF
    if (cp >= 0x0400 && cp <= 0x04FF) {
      cyrillic++;
      letters++;
    }
  }
  if (letters === 0) return 0;
  return cyrillic / letters;
}

/**
 * Detect encoding and decode `bytes` to a string.
 *
 * @param bytes  Raw file bytes (ArrayBuffer).
 * @returns      Decoded text, detected encoding, BOM flag, and ambiguous flag.
 */
export function decodeBytes(bytes: ArrayBuffer): DecodeByteResult {
  const view = new Uint8Array(bytes);

  // --- 1. BOM check -----------------------------------------------------------
  if (
    view.length >= 3 &&
    view[0] === UTF8_BOM[0] &&
    view[1] === UTF8_BOM[1] &&
    view[2] === UTF8_BOM[2]
  ) {
    const withoutBom = bytes.slice(3);
    // BOM guarantees UTF-8; use non-fatal decoder (BOM already removed).
    const text = new TextDecoder('utf-8').decode(withoutBom);
    return { text, encoding: 'utf-8', bom: true, ambiguous: false };
  }

  // --- 2. Strict UTF-8 attempt ------------------------------------------------
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text, encoding: 'utf-8', bom: false, ambiguous: false };
  } catch {
    // Falls through to cp1251 fallback.
  }

  // --- 3. windows-1251 fallback -----------------------------------------------
  // TextDecoder('windows-1251') maps every byte, so this never throws.
  const text = new TextDecoder('windows-1251').decode(bytes);

  // --- 4. Ambiguous heuristic: <1% Cyrillic among letters → caller should know --
  const ratio = cyrillicRatio(text);
  const ambiguous = ratio < 0.01;

  return { text, encoding: 'windows-1251', bom: false, ambiguous };
}
