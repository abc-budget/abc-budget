/**
 * IndexedDB implementation of the UserSettingsDAO.
 * @module internal/settings/user-settings-idb
 * @internal
 *
 * PORT of webapp/libs/engine/src/settings/user-settings-idb.ts.
 * Adaptations (diff-audit tracked here):
 *
 * 1. **IoC → DbProvider**: constructor accepts `DbProvider` (the established 1.6 pattern)
 *    instead of a `Container`.  Prior art: `super(container, { storeName, keyPath })` →
 *    here: `super(dbProvider, { storeName, keyPath })`.
 *
 * 2. **Import paths** adjusted for internal package layout.
 *    Prior-art `../store/idb` (IDBStoreConfig) is replaced by the equivalent
 *    `StoreSpec` from `../store/migrations/migration` which is the settled type.
 *
 * 3. **IDBStoreConfig → USER_SETTINGS_STORE_CONFIG**: field `name` kept (for the migration
 *    step), shape compatible with `StoreSpec` from migration.ts.
 *
 * NOTHING else changes from the verbatim prior art.
 */

import type { DbProvider } from '../store/idb/dao-impl';
import { IDBDao } from '../store/idb/dao-impl';
import type { UserSettingRecord, UserSettingsDAO } from './user-settings';

/**
 * Name of the user settings store in IndexedDB.
 */
export const USER_SETTINGS_STORE = 'userSettings';

/**
 * Configuration for the user settings store.
 * Carries exactly into migration v3 (name + keyPath + indexes).
 */
export const USER_SETTINGS_STORE_CONFIG = {
  name: USER_SETTINGS_STORE,
  keyPath: 'key',
  indexes: [
    {
      name: 'key',
      keyPath: 'key',
      options: {
        unique: true,
      },
    },
  ],
} as const;

/**
 * IndexedDB implementation of the UserSettingsDAO.
 */
export class UserSettingsIDBDAO
  extends IDBDao<string, UserSettingRecord>
  implements UserSettingsDAO
{
  /**
   * Creates a new UserSettingsIDBDAO.
   * @param dbProvider - Provides the open database instance
   */
  constructor(dbProvider: DbProvider) {
    super(dbProvider, {
      storeName: USER_SETTINGS_STORE,
      keyPath: 'key',
    });
  }

  /**
   * Gets a setting value by key.
   */
  async getSetting<T>(key: string): Promise<T | undefined> {
    const record = await this.read(key);
    return record ? (record.value as T) : undefined;
  }

  /**
   * Sets a setting value (upsert semantics).
   */
  async setSetting<T>(key: string, value: T): Promise<void> {
    const record: UserSettingRecord = { key, value };
    const existing = await this.read(key);
    if (existing) {
      await this.update(key, record);
    } else {
      await this.create(record);
    }
  }

  /**
   * Removes a setting.
   * @returns true if the setting existed and was removed, false otherwise
   */
  async removeSetting(key: string): Promise<boolean> {
    return this.delete(key);
  }

  /**
   * Gets all settings as a flat key→value map.
   */
  async getAllSettings(): Promise<Record<string, unknown>> {
    const records = await this.list();
    const settings: Record<string, unknown> = {};

    for (const record of records) {
      settings[record.key] = record.value;
    }

    return settings;
  }
}
