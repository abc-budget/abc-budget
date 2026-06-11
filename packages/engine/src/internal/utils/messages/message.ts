/**
 * Message handling system for the engine package.
 * @module internal/utils/messages/message
 *
 * Ported verbatim from prior-art `@abc-budget/utils` → `localization/messages/message.ts`.
 * Diff-audit: zero changes — pure port, no adaptation required.
 */

/**
 * Base interface for all message types
 */
export interface Message {
  /**
   * Gets the raw message text
   */
  getText(): string;

  /**
   * Indicates whether the message needs localization
   */
  isLocalizable(): boolean;

  /**
   * Translates the message using the provided translator function
   * @param translator - Function that translates a key with parameters
   * @returns The translated message
   */
  translate(
    translator: (key: string, params: Record<string, unknown>) => string
  ): string;
}

/**
 * Represents a native message that should be displayed as is without localization
 */
export class NativeMessage implements Message {
  /**
   * Creates a new native message
   * @param text - The message text
   */
  constructor(private readonly text: string) {}

  /**
   * Gets the raw message text
   * @returns The message text
   */
  getText(): string {
    return this.text;
  }

  /**
   * Indicates whether the message needs localization
   * @returns Always false for native messages
   */
  isLocalizable(): boolean {
    return false;
  }

  /**
   * For native messages, simply returns the raw text without translation
   * @param _translator - Function that translates a key with parameters (not used)
   * @returns The original message text
   */
  translate(
    _translator: (key: string, params: Record<string, unknown>) => string
  ): string {
    return this.text;
  }
}

/**
 * Represents a message that should be localized by the root application
 */
export class LocalizableMessage implements Message {
  /**
   * Creates a new localizable message
   * @param key - The localization key
   * @param params - Optional parameters for the localized message
   */
  constructor(
    private readonly key: string,
    private readonly params: Record<string, unknown> = {}
  ) {}

  /**
   * Gets the localization key
   * @returns The localization key
   */
  getText(): string {
    return this.key;
  }

  /**
   * Indicates whether the message needs localization
   * @returns Always true for localizable messages
   */
  isLocalizable(): boolean {
    return true;
  }

  /**
   * Gets the parameters for the localized message
   * @returns The parameters object
   */
  getParams(): Record<string, unknown> {
    return { ...this.params };
  }

  /**
   * Translates the message using the provided translator function
   * @param translator - Function that translates a key with parameters
   * @returns The translated message
   */
  translate(
    translator: (key: string, params: Record<string, unknown>) => string
  ): string {
    return translator(this.key, this.getParams());
  }
}
