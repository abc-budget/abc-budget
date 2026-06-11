/**
 * Exception classes for localization.
 * @module internal/utils/messages/exceptions
 *
 * Ported verbatim from prior-art `@abc-budget/utils` → `localization/messages/exceptions.ts`.
 * Diff-audit: import path updated (relative within the same messages/ folder); all
 * class bodies, method signatures, and JSDoc unchanged.
 */

import type { LocalizableMessage } from './message';

export interface ErrorOptions {
  cause?: unknown;
}

/**
 * Exception that accepts a LocalizableMessage as its message
 */
export class LocalizableException extends Error {
  /**
   * The localizable message associated with this exception
   */
  private readonly localizableMessage: LocalizableMessage;

  /**
   * Creates a new localizable exception
   * @param message - The localizable message
   * @param options - Additional error options
   */
  constructor(message: LocalizableMessage, options?: ErrorOptions) {
    // Pass the raw message text to the Error constructor
    super(message.getText(), options);

    // Store the localizable message for later use
    this.localizableMessage = message;

    // Set the prototype explicitly to ensure instanceof works correctly
    Object.setPrototypeOf(this, LocalizableException.prototype);

    // Set the name of the error
    this.name = 'LocalizableException';
  }

  /**
   * Gets the localizable message associated with this exception
   * @returns The localizable message
   */
  getLocalizableMessage(): LocalizableMessage {
    return this.localizableMessage;
  }

  /**
   * Translates the exception message using the provided translator function
   * @param translator - Function that translates a key with parameters
   * @returns The translated exception message
   */
  translateMessage(
    translator: (key: string, params: Record<string, unknown>) => string
  ): string {
    return this.localizableMessage.translate(translator);
  }
}
