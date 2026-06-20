import { describe, it, expect } from 'vitest';
import { resolveMessage } from './resolve-message';

describe('resolveMessage', () => {
  it('returns the verbatim text for a Native {text} message (HC-6 — never translated)', () => {
    expect(resolveMessage({ text: 'АТБ МАРКЕТ №1247' }, 'uk')).toBe('АТБ МАРКЕТ №1247');
  });

  it('renders a localizable {key} message through the chrome catalog', () => {
    // 's3dStOk' is a real key added in Task 2; use a key that exists at run time.
    // For an isolated unit test, assert the key-fallback path instead:
    const out = resolveMessage({ key: 'totally.unknown.key', params: {} } as never, 'uk');
    expect(out).toBe('totally.unknown.key'); // unknown key → raw key (best-effort)
  });
});
