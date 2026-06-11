/**
 * Ported from prior-art `@abc-budget/utils` → `localization/messages/multiple-errors.spec.ts`.
 * Diff-audit: `jest.fn()` / `jest.mock()` not used in this file; added vitest imports;
 * all assertions preserved verbatim.
 */
import { describe, expect, it } from 'vitest';
import {
  $t,
  LocalizableException,
  LocalizableMessage,
  MultipleErrorsException,
} from './index';

describe('MultipleErrorsException', () => {
  it('creates an exception with the provided localizable message', () => {
    const key = 'error.key';
    const params = { count: 3 } as const;
    const message = new LocalizableMessage(key, params);
    const exception = new MultipleErrorsException(message);

    expect(exception).toBeDefined();
    expect(exception.name).toBe('MultipleErrorsException');
    // Raw message text is used in Error.message
    expect(exception.message).toBe(key);
    expect(exception.getLocalizableMessage()).toBe(message);
  });

  it('is an instance of Error, LocalizableException, and MultipleErrorsException', () => {
    const message = new LocalizableMessage('error.key');
    const exception = new MultipleErrorsException(message);

    expect(exception instanceof Error).toBe(true);
    expect(exception instanceof LocalizableException).toBe(true);
    expect(exception instanceof MultipleErrorsException).toBe(true);
  });

  it('initializes with an empty errors array if none provided', () => {
    const message = new LocalizableMessage('error.key');
    const exception = new MultipleErrorsException(message);

    expect(exception.getErrors()).toEqual([]);
    expect(exception.hasErrors()).toBe(false);
  });

  it('initializes with the provided errors array', () => {
    const message = new LocalizableMessage('error.key');
    const error1 = new LocalizableException($t('error.one'));
    const error2 = new LocalizableException($t('error.two'));
    const errors = [error1, error2];
    const exception = new MultipleErrorsException(message, errors);

    expect(exception.getErrors()).toEqual(errors);
    expect(exception.hasErrors()).toBe(true);
  });

  it('adds errors to the collection', () => {
    const message = new LocalizableMessage('error.key');
    const exception = new MultipleErrorsException(message);
    const error = new LocalizableException($t('error.test'));

    exception.addError(error);

    expect(exception.getErrors()).toEqual([error]);
    expect(exception.hasErrors()).toBe(true);
  });

  it('returns a copy of the errors array to prevent modification', () => {
    const message = new LocalizableMessage('error.key');
    const error = new LocalizableException($t('error.test'));
    const exception = new MultipleErrorsException(message, [error]);

    const returnedErrors = exception.getErrors();
    const newError = new LocalizableException($t('error.new'));
    returnedErrors.push(newError); // Modify the returned array copy

    // Original errors in the exception should not be affected
    expect(exception.getErrors()).toEqual([error]);
    expect(exception.getErrors().length).toBe(1);
  });

  it('creates a stage3 error with the provided errors', () => {
    const error1 = new LocalizableException($t('error.one'));
    const error2 = new LocalizableException($t('error.two'));
    const errors = [error1, error2];
    const exception = MultipleErrorsException.createStage3Error(errors);

    expect(exception).toBeDefined();
    expect(exception.name).toBe('MultipleErrorsException');
    expect(exception.getErrors()).toEqual(errors);
    expect(exception.hasErrors()).toBe(true);

    // Check that the message uses the correct key and params
    const message = exception.getLocalizableMessage();
    expect(message.getText()).toBe(
      'engine.importStatement.stage3.multiple-errors'
    );
    expect(message.getParams()).toEqual({ count: 2 });
  });

  it('creates a stage3 error with an empty errors array if none provided', () => {
    const exception = MultipleErrorsException.createStage3Error();

    expect(exception).toBeDefined();
    expect(exception.name).toBe('MultipleErrorsException');
    expect(exception.getErrors()).toEqual([]);
    expect(exception.hasErrors()).toBe(false);

    // Check that the message uses the correct key and params
    const message = exception.getLocalizableMessage();
    expect(message.getText()).toBe(
      'engine.importStatement.stage3.multiple-errors'
    );
    expect(message.getParams()).toEqual({ count: 0 });
  });
});
