/**
 * Type definitions for the settings module.
 * @module internal/settings/types
 * @internal
 *
 * PORT of webapp/libs/engine/src/settings/types.ts.
 * Adaptations: none — shape is identical.
 */

/**
 * Interface for user settings validator.
 */
export interface UserSettingsValidator {
  /** The key of the setting to validate. */
  key: string;

  /**
   * Validates a setting value.
   * @param value - The value to validate
   * @returns True if the value is valid, false otherwise
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validate(value: any): boolean;
}
