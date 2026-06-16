/**
 * Convenience helpers for the last-remainder-category setting.
 * @module internal/settings/last-remainder-category
 * @internal
 *
 * NEW in Story 4.6, Task 1 (decision C).
 *
 * Cross-import memory for the «Решту → Інше» picker: written on dump-confirm
 * (Story 4.6) so the next import remembers where the remainder went, and read
 * by Story 4.9 as the picker's default selection.
 *
 * `getLastRemainderCategoryId()` — reads from the injected UserSettingsDAO;
 * returns null when unset.  Unlike base-currency, an unset last-remainder-
 * category is a NORMAL default (the first-ever dump has no memory), NOT a flow
 * bug — so this returns null instead of throwing.
 *
 * `setLastRemainderCategoryId(id)` — persists it (last-write-wins).  The stored
 * id is RAW: it is written verbatim with no existence check, because a category
 * may be archived between dumps.  The picker (4.9) is responsible for resolving
 * and validating a possibly since-archived id.
 */

import type { UserSettingsDAO } from './user-settings';
import { SettingKeys } from './user-settings';

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Returns the stored last-remainder-category id, or null when unset.
 *
 * "Unset" is an EXPECTED state — the first dump has no remembered category — so
 * this returns null instead of throwing.  Story 4.9 reads this as the picker
 * default; the stored id is raw, so the picker must resolve/validate a
 * possibly since-archived category.
 *
 * @param dao - The user settings DAO to read from
 */
export async function getLastRemainderCategoryId(dao: UserSettingsDAO): Promise<string | null> {
  const value = await dao.getSetting<string>(SettingKeys.LAST_REMAINDER_CATEGORY_ID);
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return value;
}

/**
 * Persists the last-remainder-category id (last-write-wins).
 *
 * The id is stored RAW — no existence check — because the category may be
 * archived before the next dump; the picker (4.9) resolves/validates it.
 *
 * @param dao - The user settings DAO to write to
 * @param id - The category id to remember as the remainder default
 */
export async function setLastRemainderCategoryId(dao: UserSettingsDAO, id: string): Promise<void> {
  await dao.setSetting(SettingKeys.LAST_REMAINDER_CATEGORY_ID, id);
}
