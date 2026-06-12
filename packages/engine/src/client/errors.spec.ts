/**
 * Wire-error codec round-trip tests (TDD — written before errors.ts).
 *
 * Each typed error: serialize → rehydrate → assert class identity + payload
 * fidelity.  Unknown errors must rehydrate as EngineError preserving the
 * original name (HC-7: never silently mangled).
 */

import { describe, it, expect } from 'vitest';
import { NativeMessage, LocalizableMessage } from '../internal/utils/messages/message';
import { ColumnTransformRejection } from '../internal/importStatement/stage2/errors';
import { UnmappedColumnsError } from '../internal/importStatement/stage2/errors';
import { BaseCurrencyNotSetError } from '../internal/settings/base-currency';
import {
  serializeEngineError,
  rehydrateEngineError,
  ContractMismatchError,
  EngineWorkerDiedError,
  SessionAlreadyActiveError,
  SessionUnknownError,
  EngineError,
} from './errors';

// ── ColumnTransformRejection ──────────────────────────────────────────────────

describe('ColumnTransformRejection round-trip', () => {
  it('rehydrates as ColumnTransformRejection with counts + threshold', () => {
    const original = new ColumnTransformRejection(
      3, 10, 0.3,
      [{ rowIndex: 1, error: new NativeMessage('bad') }],
      'engine.importStatement.column-parse-error',
    );
    const wire = serializeEngineError(original);
    const rehydrated = rehydrateEngineError(wire);

    expect(rehydrated).toBeInstanceOf(ColumnTransformRejection);
    const r = rehydrated as ColumnTransformRejection;
    expect(r.errorCount).toBe(3);
    expect(r.totalCount).toBe(10);
    expect(r.threshold).toBe(0.3);
  });

  it('rehydrates cellErrors with rowIndex (payload fidelity)', () => {
    const err = new LocalizableMessage('engine.importStatement.parse-error', { col: 'Date' });
    const original = new ColumnTransformRejection(
      1, 5, 0.3,
      [{ rowIndex: 2, error: err }],
      'engine.importStatement.column-parse-error',
    );
    const rehydrated = rehydrateEngineError(serializeEngineError(original)) as ColumnTransformRejection;
    expect(rehydrated.cellErrors).toHaveLength(1);
    expect(rehydrated.cellErrors[0].rowIndex).toBe(2);
  });

  it('preserves name = "ColumnTransformRejection"', () => {
    const original = new ColumnTransformRejection(
      1, 3, 0.3,
      [{ rowIndex: 0, error: new NativeMessage('e') }],
      'engine.importStatement.column-parse-error',
    );
    const rehydrated = rehydrateEngineError(serializeEngineError(original));
    expect(rehydrated.name).toBe('ColumnTransformRejection');
  });

  it('survives JSON round-trip on the wire object', () => {
    const original = new ColumnTransformRejection(
      1, 4, 0.3,
      [{ rowIndex: 0, error: new NativeMessage('e') }],
      'engine.importStatement.column-parse-error',
    );
    const wire = serializeEngineError(original);
    const wireJson = JSON.parse(JSON.stringify(wire));
    const rehydrated = rehydrateEngineError(wireJson) as ColumnTransformRejection;
    expect(rehydrated.errorCount).toBe(1);
    expect(rehydrated.cellErrors[0].rowIndex).toBe(0);
  });
});

// ── UnmappedColumnsError ──────────────────────────────────────────────────────

describe('UnmappedColumnsError round-trip', () => {
  it('rehydrates as UnmappedColumnsError with unmappedColumns', () => {
    const original = new UnmappedColumnsError([
      { id: 'col-a', name: 'ColA' },
      { id: 'col-b', name: 'ColB' },
    ]);
    const rehydrated = rehydrateEngineError(serializeEngineError(original)) as UnmappedColumnsError;
    expect(rehydrated).toBeInstanceOf(UnmappedColumnsError);
    expect(rehydrated.unmappedColumns).toHaveLength(2);
    expect(rehydrated.unmappedColumns[0].id).toBe('col-a');
    expect(rehydrated.unmappedColumns[1].name).toBe('ColB');
  });

  it('preserves name = "UnmappedColumnsError"', () => {
    const original = new UnmappedColumnsError([{ id: 'x', name: 'X' }]);
    expect(rehydrateEngineError(serializeEngineError(original)).name).toBe('UnmappedColumnsError');
  });
});

// ── BaseCurrencyNotSetError ───────────────────────────────────────────────────

describe('BaseCurrencyNotSetError round-trip', () => {
  it('rehydrates as BaseCurrencyNotSetError', () => {
    const original = new BaseCurrencyNotSetError();
    const rehydrated = rehydrateEngineError(serializeEngineError(original));
    expect(rehydrated).toBeInstanceOf(BaseCurrencyNotSetError);
    expect(rehydrated.name).toBe('BaseCurrencyNotSetError');
  });
});

// ── ContractMismatchError (NEW) ───────────────────────────────────────────────

describe('ContractMismatchError round-trip', () => {
  it('is constructible with ours/theirs', () => {
    const err = new ContractMismatchError(2, 1);
    expect(err.ours).toBe(2);
    expect(err.theirs).toBe(1);
    expect(err.name).toBe('ContractMismatchError');
    expect(err).toBeInstanceOf(Error);
  });

  it('round-trips through serialize/rehydrate', () => {
    const original = new ContractMismatchError(2, 3);
    const rehydrated = rehydrateEngineError(serializeEngineError(original)) as ContractMismatchError;
    expect(rehydrated).toBeInstanceOf(ContractMismatchError);
    expect(rehydrated.ours).toBe(2);
    expect(rehydrated.theirs).toBe(3);
  });
});

// ── EngineWorkerDiedError (NEW) ───────────────────────────────────────────────

describe('EngineWorkerDiedError round-trip', () => {
  it('is constructible with jobsLost', () => {
    const err = new EngineWorkerDiedError(5);
    expect(err.jobsLost).toBe(5);
    expect(err.name).toBe('EngineWorkerDiedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('round-trips with jobsLost fidelity', () => {
    const original = new EngineWorkerDiedError(7);
    const rehydrated = rehydrateEngineError(serializeEngineError(original)) as EngineWorkerDiedError;
    expect(rehydrated).toBeInstanceOf(EngineWorkerDiedError);
    expect(rehydrated.jobsLost).toBe(7);
  });
});

// ── SessionAlreadyActiveError (NEW) ──────────────────────────────────────────

describe('SessionAlreadyActiveError round-trip', () => {
  it('is constructible with activeSessionId', () => {
    const err = new SessionAlreadyActiveError('sess-123');
    expect(err.activeSessionId).toBe('sess-123');
    expect(err.name).toBe('SessionAlreadyActiveError');
    expect(err).toBeInstanceOf(Error);
  });

  it('round-trips with activeSessionId fidelity', () => {
    const original = new SessionAlreadyActiveError('sess-abc');
    const rehydrated = rehydrateEngineError(serializeEngineError(original)) as SessionAlreadyActiveError;
    expect(rehydrated).toBeInstanceOf(SessionAlreadyActiveError);
    expect(rehydrated.activeSessionId).toBe('sess-abc');
  });
});

// ── SessionUnknownError (NEW) ─────────────────────────────────────────────────

describe('SessionUnknownError round-trip', () => {
  it('is constructible with sessionId', () => {
    const err = new SessionUnknownError('sess-old');
    expect(err.sessionId).toBe('sess-old');
    expect(err.name).toBe('SessionUnknownError');
    expect(err).toBeInstanceOf(Error);
  });

  it('round-trips with sessionId fidelity', () => {
    const original = new SessionUnknownError('sess-xyz');
    const rehydrated = rehydrateEngineError(serializeEngineError(original)) as SessionUnknownError;
    expect(rehydrated).toBeInstanceOf(SessionUnknownError);
    expect(rehydrated.sessionId).toBe('sess-xyz');
  });
});

// ── Unknown errors → EngineError (HC-7) ──────────────────────────────────────

describe('unknown error → EngineError (HC-7)', () => {
  it('preserves the original name from the wire payload', () => {
    const wire = {
      name: 'SomeObscureInternalError',
      message: 'something went wrong',
      payload: null,
    };
    const rehydrated = rehydrateEngineError(wire) as EngineError;
    expect(rehydrated).toBeInstanceOf(EngineError);
    expect(rehydrated.name).toBe('SomeObscureInternalError');
    expect(rehydrated.message).toBe('something went wrong');
  });

  it('serializes a plain Error preserving name + message', () => {
    class WeirdError extends Error {
      constructor() {
        super('weird thing');
        this.name = 'WeirdError';
      }
    }
    const wire = serializeEngineError(new WeirdError());
    const rehydrated = rehydrateEngineError(wire);
    expect(rehydrated.name).toBe('WeirdError');
    expect(rehydrated.message).toBe('weird thing');
  });

  it('EngineError instanceof Error', () => {
    const wire = { name: 'FooError', message: 'foo', payload: null };
    const rehydrated = rehydrateEngineError(wire);
    expect(rehydrated).toBeInstanceOf(Error);
  });
});
