import type { SerializedMessage } from '@abc-budget/engine';
import type { ChromeKey } from './i18n';
import { t as translate } from './i18n';

/**
 * Resolve a SerializedMessage to a display string.
 * Native (`{text}`) → text verbatim (HC-6 — user content is never translated).
 * Localizable (`{key, params}`) → the chrome catalog rendering when the key
 * exists there, else the raw key (best-effort — engine keys are not all in the
 * web chrome catalog).
 */
export function resolveMessage(msg: SerializedMessage, lang: 'uk' | 'en'): string {
  if ('text' in msg) return msg.text;
  try {
    const rendered = translate(lang, msg.key as ChromeKey, msg.params as Record<string, string | number>);
    return rendered ?? msg.key;
  } catch {
    return msg.key;
  }
}
