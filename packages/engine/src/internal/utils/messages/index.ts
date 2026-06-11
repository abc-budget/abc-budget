/**
 * Message handling system exports.
 * @module internal/utils/messages
 *
 * Ported verbatim from prior-art `@abc-budget/utils` → `localization/messages/index.ts`.
 * Diff-audit: re-export paths updated to relative within messages/; the `$t` alias,
 * `createNativeMessage`, and `createLocalizableMessage` factory signatures are unchanged.
 */

import { LocalizableMessage, NativeMessage } from './message';

export * from './exceptions';
export * from './message';
export * from './multiple-errors';

/**
 * Creates a new native message
 * @param text - The message text
 * @returns A new NativeMessage instance
 */
export function createNativeMessage(text: string): NativeMessage {
  return new NativeMessage(text);
}

/**
 * Creates a new localizable message
 * @param key - The localization key
 * @param params - Optional parameters for the localized message
 * @returns A new LocalizableMessage instance
 */
export function createLocalizableMessage(
  key: string,
  params: Record<string, unknown> = {}
): LocalizableMessage {
  return new LocalizableMessage(key, params);
}

/**
 * Short alias for `createLocalizableMessage`.
 *
 * The `$t` variable mirrors the prior-art `@abc-budget/utils` surface so ported
 * code can import `$t` without changes.  It creates a `LocalizableMessage` that
 * the root application later translates via its i18n translator.
 *
 * @param key    Localization key, e.g. `'engine.importStatement.column.error'`
 * @param params Optional interpolation parameters
 */
export const $t: (
  key: string,
  params?: Record<string, unknown>
) => LocalizableMessage = createLocalizableMessage;
