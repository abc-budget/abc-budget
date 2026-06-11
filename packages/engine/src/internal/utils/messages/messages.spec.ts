/**
 * Ported from prior-art `@abc-budget/utils` → `localization/messages/localization.spec.ts`.
 * Diff-audit: `jest.fn()` → `vi.fn()`; `import { describe, it, expect, vi }` added;
 * all assertions preserved verbatim.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  $t,
  createLocalizableMessage,
  createNativeMessage,
  LocalizableException,
  LocalizableMessage,
  NativeMessage,
} from './index';

describe('Message System', () => {
  describe('NativeMessage', () => {
    it('should create a native message with the provided text', () => {
      const text = 'This is a native message';
      const message = new NativeMessage(text);

      expect(message).toBeDefined();
      expect(message.getText()).toBe(text);
      expect(message.isLocalizable()).toBe(false);
    });

    it('should create a native message using the factory function', () => {
      const text = 'This is a native message';
      const message = createNativeMessage(text);

      expect(message).toBeDefined();
      expect(message.getText()).toBe(text);
      expect(message.isLocalizable()).toBe(false);
    });

    it('should return the raw text when translated', () => {
      const text = 'This is a native message';
      const message = new NativeMessage(text);

      // Translator function should not be used for native messages
      const translator = vi.fn().mockReturnValue('Translated text');

      const result = message.translate(translator);

      expect(result).toBe(text);
      expect(translator).not.toHaveBeenCalled();
    });
  });

  describe('LocalizableMessage', () => {
    it('should create a localizable message with the provided key', () => {
      const key = 'message.key';
      const message = new LocalizableMessage(key);

      expect(message).toBeDefined();
      expect(message.getText()).toBe(key);
      expect(message.isLocalizable()).toBe(true);
      expect(message.getParams()).toEqual({});
    });

    it('should create a localizable message with parameters', () => {
      const key = 'message.key';
      const params = { name: 'John', count: 3 } as const;
      const message = new LocalizableMessage(key, params);

      expect(message).toBeDefined();
      expect(message.getText()).toBe(key);
      expect(message.isLocalizable()).toBe(true);
      expect(message.getParams()).toEqual(params);
    });

    it('should create a localizable message using the factory function', () => {
      const key = 'message.key';
      const params = { name: 'John', count: 3 };
      const message = createLocalizableMessage(key, params);

      expect(message).toBeDefined();
      expect(message.getText()).toBe(key);
      expect(message.isLocalizable()).toBe(true);
      expect(message.getParams()).toEqual(params);
    });

    it('should create a localizable message using the short alias $t', () => {
      const key = 'message.key';
      const params = { name: 'John', count: 3 };
      const message = $t(key, params);

      expect(message).toBeDefined();
      expect(message.getText()).toBe(key);
      expect(message.isLocalizable()).toBe(true);
      expect(message.getParams()).toEqual(params);
    });

    it('should return a copy of parameters to prevent modification', () => {
      const key = 'message.key';
      const params = { name: 'John', count: 3 };
      const message = new LocalizableMessage(key, params);

      const returnedParams = message.getParams();
      (returnedParams as Record<string, unknown>)['name'] = 'Jane'; // Modify the returned params copy

      // Original params in the message should not be affected
      expect(message.getParams()).toEqual(params);
      expect(message.getParams()['name']).toBe('John');
    });

    it('should use the translator function when translated', () => {
      const key = 'message.key';
      const params = { name: 'John', count: 3 };
      const message = new LocalizableMessage(key, params);
      const translatedText = 'Hello, John! You have 3 messages.';

      // Translator function should be called with the key and params
      const translator = vi.fn().mockReturnValue(translatedText);

      const result = message.translate(translator);

      expect(result).toBe(translatedText);
      expect(translator).toHaveBeenCalledWith(key, params);
    });
  });

  describe('LocalizableException', () => {
    it('should create an exception with the provided localizable message', () => {
      const key = 'error.key';
      const params = { code: 404, resource: 'User' } as const;
      const message = new LocalizableMessage(key, params);
      const exception = new LocalizableException(message);

      expect(exception).toBeDefined();
      expect(exception.name).toBe('LocalizableException');
      expect(exception.message).toBe(key); // Raw message text is used in Error.message
      expect(exception.getLocalizableMessage()).toBe(message);
    });

    it('should translate the exception message using the provided translator', () => {
      const key = 'error.key';
      const params = { code: 404, resource: 'User' } as const;
      const message = new LocalizableMessage(key, params);
      const exception = new LocalizableException(message);
      const translatedText = 'Resource User not found (404)';

      const translator = vi.fn().mockReturnValue(translatedText);

      const result = exception.translateMessage(translator);

      expect(result).toBe(translatedText);
      expect(translator).toHaveBeenCalledWith(key, params);
    });

    it('should be an instance of Error and LocalizableException', () => {
      const message = new LocalizableMessage('error.key');
      const exception = new LocalizableException(message);

      expect(exception instanceof Error).toBe(true);
      expect(exception instanceof LocalizableException).toBe(true);
    });
  });
});
