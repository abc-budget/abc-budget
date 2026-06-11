/**
 * Multiple errors exception class.
 * @module internal/utils/messages/multiple-errors
 *
 * Ported verbatim from prior-art `@abc-budget/utils` → `localization/messages/multiple-errors.ts`.
 * Diff-audit: import paths updated to relative within messages/; all class bodies,
 * static factory methods, and JSDoc unchanged.
 */

import type { ErrorOptions } from './exceptions';
import { LocalizableException } from './exceptions';
import { LocalizableMessage } from './message';

/**
 * Exception that collects multiple errors
 */
export class MultipleErrorsException extends LocalizableException {
  /**
   * The errors collected by this exception
   */
  private readonly errors: LocalizableException[] = [];

  /**
   * Creates a new multiple errors exception
   * @param message - The main error message
   * @param errors - Initial errors to add
   * @param options - Additional error options
   */
  constructor(
    message: LocalizableMessage,
    errors: LocalizableException[] = [],
    options?: ErrorOptions
  ) {
    super(message, options);

    // Add initial errors
    this.errors = [...errors];

    // Set the prototype explicitly to ensure instanceof works correctly
    Object.setPrototypeOf(this, MultipleErrorsException.prototype);

    // Set the name of the error
    this.name = 'MultipleErrorsException';
  }

  /**
   * Adds an error to the collection
   * @param error - The error to add
   */
  addError(error: LocalizableException): void {
    this.errors.push(error);
  }

  /**
   * Gets all errors collected by this exception
   * @returns The array of errors
   */
  getErrors(): LocalizableException[] {
    return [...this.errors];
  }

  /**
   * Checks if the exception has any errors
   * @returns True if there are errors, false otherwise
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Creates a new multiple errors exception for stage3 processing
   * @param errors - The errors to include
   * @returns A new MultipleErrorsException
   */
  static createStage3Error(
    errors: LocalizableException[] = []
  ): MultipleErrorsException {
    return new MultipleErrorsException(
      new LocalizableMessage('engine.importStatement.stage3.multiple-errors', {
        count: errors.length,
      }),
      errors
    );
  }
}
