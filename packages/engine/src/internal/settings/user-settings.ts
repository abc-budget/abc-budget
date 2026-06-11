/**
 * User settings interfaces and implementations.
 * @module internal/settings/user-settings
 * @internal
 *
 * PORT of webapp/libs/engine/src/settings/user-settings.ts (289 lines).
 * Adaptations (diff-audit tracked here):
 *
 * 1. **IoC → injection**: `Container` parameter removed; `UserSettingsServiceImpl`
 *    accepts `UserSettingsDAO` and optional `UserSettingsValidator[]` directly.
 *    No Container / IoCKeys imports.
 *
 * 2. **AbcEngineParams / engine types removed**: `init()` no longer resolves ENGINE_PARAMS
 *    from a container.  The `defaultUserSettings` behaviour on DB-remove is dropped
 *    (it was IoC-event-driven wiring not needed in this context-free port).
 *
 * 3. **RxJS retained** — BehaviorSubject / Observable are prior-art dependencies that
 *    carry through unchanged.  NOTE: rxjs is listed as a dependency only in the
 *    engine package (internal use); it must NOT appear on the public surface.
 *
 * 4. **Import paths** adjusted for the internal package layout.
 *
 * 5. **verbatimModuleSyntax** — `import type` used for type-only imports.
 *
 * NOTHING else changes from the verbatim prior art.
 */

import { BehaviorSubject, type Observable } from 'rxjs';
import type { UserSettingsValidator } from './types';

// ── Re-exported so callers only need one import ──────────────────────────────

export type { UserSettingsValidator } from './types';

// ── Interfaces ───────────────────────────────────────────────────────────────

/**
 * Structure of a user setting record stored in IndexedDB.
 */
export interface UserSettingRecord {
  key: string;
  value: unknown;
}

/**
 * Interface for user settings data access object.
 */
export interface UserSettingsDAO {
  /**
   * Gets a setting value by key.
   * @param key - The key of the setting
   * @returns A promise that resolves to the setting value, or undefined if not found
   */
  getSetting<T>(key: string): Promise<T | undefined>;

  /**
   * Sets a setting value.
   * @param key - The key of the setting
   * @param value - The value to set
   * @returns A promise that resolves when the setting is set
   */
  setSetting<T>(key: string, value: T): Promise<void>;

  /**
   * Removes a setting.
   * @param key - The key of the setting to remove
   * @returns A promise that resolves to true if the setting was removed, false if it didn't exist
   */
  removeSetting(key: string): Promise<boolean>;

  /**
   * Gets all settings.
   * @returns A promise that resolves to a record of all settings
   */
  getAllSettings(): Promise<Record<string, unknown>>;
}

// ── Error ────────────────────────────────────────────────────────────────────

/**
 * Error thrown when a setting value is invalid.
 */
export class InvalidSettingError extends Error {
  constructor(key: string, message: string) {
    super(`Invalid setting value for ${key}: ${message}`);
    this.name = 'InvalidSettingError';
  }
}

// ── Keys ─────────────────────────────────────────────────────────────────────

/**
 * Keys for predefined settings.
 */
export enum SettingKeys {
  BASE_CURRENCY = 'baseCurrency',

  // engineConfig.* keys (Story 2.4 — store-backed engine params, ENT-016/NFR-009)
  ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE = 'engineConfig.acceptableParseDatePercentage',
  ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE = 'engineConfig.acceptableColumnErrorPercentage',
  ENGINE_SUCCESS_STATUS_THRESHOLD = 'engineConfig.successStatusThreshold',
  ENGINE_RECALL_AUTO_DETECT_ENABLED = 'engineConfig.recallAutoDetectEnabled',
}

// ── Abstract base ─────────────────────────────────────────────────────────────

/**
 * Abstract base class for the user settings service.
 * Verbatim call surface from the prior art.
 */
export abstract class UserSettingsService {
  abstract getSetting<T>(key: string): Promise<T | undefined>;
  abstract setSetting<T>(key: string, value: T): Promise<void>;
  abstract getBaseCurrency(): Promise<string | undefined>;
  abstract setBaseCurrency(currencyCode: string): Promise<void>;
  abstract getAllSettings<T>(): Observable<T>;
  abstract init(): Promise<void>;
  abstract close(): void;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Implementation of the user settings service.
 *
 * PORT adaptation: constructor receives `dao` and optional `validators` directly
 * instead of resolving them from a Container.
 */
export class UserSettingsServiceImpl extends UserSettingsService {
  private readonly dao: UserSettingsDAO;
  private readonly validators: Map<string, UserSettingsValidator>;
  private readonly settingsSubject: BehaviorSubject<Record<string, unknown>>;
  private broadcastChannel: BroadcastChannel | null = null;
  private static readonly BROADCAST_CHANNEL_NAME = 'user-settings-channel';
  private readonly currentSourceId: string;

  /**
   * Creates a new user settings service.
   * @param dao - The user settings DAO
   * @param validators - Optional array of setting validators
   */
  constructor(dao: UserSettingsDAO, validators: UserSettingsValidator[] = []) {
    super();
    this.dao = dao;
    this.validators = new Map();
    this.settingsSubject = new BehaviorSubject<Record<string, unknown>>({});
    // Generate a unique source ID for broadcast channel messages
    this.currentSourceId = `uss-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    for (const validator of validators) {
      this.validators.set(validator.key, validator);
    }
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return this.dao.getSetting<T>(key);
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    const validator = this.validators.get(key);
    if (validator && !validator.validate(value)) {
      throw new InvalidSettingError(key, 'Value failed validation');
    }

    await this.dao.setSetting(key, value);

    const currentSettings = this.settingsSubject.getValue();
    const updatedSettings = { ...currentSettings, [key]: value };
    this.settingsSubject.next(updatedSettings);

    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({
        key,
        value,
        source: this.currentSourceId,
      });
    }
  }

  async getBaseCurrency(): Promise<string | undefined> {
    return this.getSetting<string>(SettingKeys.BASE_CURRENCY);
  }

  async setBaseCurrency(currencyCode: string): Promise<void> {
    await this.setSetting(SettingKeys.BASE_CURRENCY, currencyCode);
  }

  getAllSettings<T>(): Observable<T> {
    return this.settingsSubject.asObservable() as Observable<T>;
  }

  /**
   * Initializes the settings service.
   * Loads all settings from the DAO and sets up the broadcast channel.
   */
  async init(): Promise<void> {
    // Load all settings from the DAO
    const settings = await this.dao.getAllSettings();
    this.settingsSubject.next(settings);

    // Set up the broadcast channel for cross-tab communication
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel(
        UserSettingsServiceImpl.BROADCAST_CHANNEL_NAME,
      );

      this.broadcastChannel.onmessage = (event) => {
        if (event.data && typeof event.data === 'object') {
          const { key, value, source } = event.data as Record<string, unknown>;

          if (this.currentSourceId === source) {
            return;
          }

          const currentSettings = this.settingsSubject.getValue();
          const updatedSettings = { ...currentSettings, [key as string]: value };
          this.settingsSubject.next(updatedSettings);
        }
      };
    }
  }

  close(): void {
    this.broadcastChannel?.close();
    this.settingsSubject.complete();
  }
}
