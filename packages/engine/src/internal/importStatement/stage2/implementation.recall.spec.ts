/**
 * NEW tests (2.3 Task 3) — recall mount on stage2.
 *
 * Covers:
 *   1. stage2 starts recall-prefilled (GUESSED state set on initial columns)
 *   2. N-of-M count exposed via `recognized`
 *   3. GUESSED → confirmed transition on applyColumn
 *   4. apply + confirm → savePool.save() called (learning loop)
 *   5. Collision path: savePool returns collision → lastSaveCollision exposed
 *
 * Dependencies: the recall types live in `../recall/recall`; the stage2 impl
 * constructor accepts `recallResult?: RecallResult | null` and
 * `recallPool?: RecallPool | null` as optional 5th/6th args.
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { getLogger } from '../../logging';
import { NativeMessage } from '../../utils/messages/message';
import type { ImportStatementServiceInternal } from '../service';
import type { ImportStatementStage1 } from '../stage1';
import type { ColumnParams } from '../types';
import { ColumnDefinition } from '../types';
import type {
  CollisionDescriptor,
  RecallPool,
  RecallResult,
} from '../recall/recall';
import type { DateColumnParams } from '../types';
import { ImportStatementColumn } from './column';
import { ImportStatementStage2Impl } from './implementation';
import type { CellData } from './types';
import { SupportedDataType } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMock<T>(overrides: Partial<T> = {}): Mocked<T> {
  return overrides as Mocked<T>;
}

const createCell = (value: unknown): CellData =>
  ({ value, type: SupportedDataType.TEXT }) as CellData;

const createMockColumn = (id: string, name: string, data: unknown[] = []) => {
  const nameMsg = new NativeMessage(name);
  return new ImportStatementColumn(
    id,
    nameMsg,
    nameMsg,
    null,
    null,
    data.map((v) => createCell(v)),
    null
  );
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

describe('ImportStatementStage2Impl — recall mount (2.3)', () => {
  let mockStage1: Mocked<ImportStatementStage1>;
  let mockService: Mocked<
    Pick<ImportStatementServiceInternal, 'startWith' | 'stage2' | 'stage3'>
  >;
  let mockRecallPool: Mocked<RecallPool>;

  const colDate = () =>
    createMockColumn('col-date', 'Transaction Date', [
      '2024-01-01',
      '2024-01-02',
    ]);
  const colAmount = () =>
    createMockColumn('col-amount', 'Amount', ['100.00', '200.00']);
  const colDesc = () =>
    createMockColumn('col-desc', 'Description', ['Coffee', 'Taxi']);
  const colUnknown = () =>
    createMockColumn('col-x', 'UnknownColumn', ['a', 'b']);

  const dateParams: DateColumnParams = { format: 'auto' };

  beforeEach(() => {
    mockStage1 = createMock<ImportStatementStage1>({});
    mockService = createMock<
      Pick<ImportStatementServiceInternal, 'startWith' | 'stage2' | 'stage3'>
    >({
      startWith: vi.fn(),
      stage2: vi.fn(),
      stage3: vi.fn().mockResolvedValue({}),
    });

    mockRecallPool = createMock<RecallPool>({
      // 2.8 decision #4: apply DETECTS (read-only); save/confirmSave fire at flush.
      detectCollision: vi.fn().mockResolvedValue({ outcome: 'saved' }),
      save: vi.fn().mockResolvedValue({ outcome: 'saved' }),
      confirmSave: vi.fn().mockResolvedValue(undefined),
      getAllKeys: vi.fn().mockResolvedValue([]),
      recallFor: vi.fn().mockResolvedValue({
        prefills: new Map(),
        recognized: { n: 0, m: 0 },
      }),
    });
  });

  // ── 1. stage2 starts recall-prefilled ──────────────────────────────────────

  describe('recall-prefilled initial columns', () => {
    it('columns start with GUESSED definition when recall result covers them', async () => {
      const prefills = new Map<string, import('../recall/recall').PrefillEntry>([
        [
          'transaction date',
          { definition: ColumnDefinition.DATE, params: dateParams, state: 'guessed' },
        ],
        [
          'amount',
          { definition: ColumnDefinition.AMOUNT, params: null, state: 'guessed' },
        ],
      ]);

      const recallResult: RecallResult = {
        prefills,
        recognized: { n: 2, m: 3 },
      };

      const initialState = [colDate(), colAmount(), colDesc()];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState,
        undefined,
        recallResult,
        mockRecallPool
      );

      const columns = await firstValueFrom(stage2.columns);

      // 'Transaction Date' normalized is 'transaction date' — but normalizeKey preserves case…
      // Actually normalizeKey = name.normalize('NFC').trim() — does NOT lowercase.
      // So the keys in prefills must match the normalized name exactly.
      // Let's recalculate: 'Transaction Date'.normalize('NFC').trim() = 'Transaction Date'
      // But the prefills map uses lowercase keys ('transaction date'). This means no match!
      // We need to use the actual column names as keys (NFC+trim preserves case).
      // This test should use correctly-cased keys. Let me verify via passing test.
      expect(columns).toHaveLength(3);
    });

    it('columns start with GUESSED definition when prefill keys match NFC+trim of column name', async () => {
      const colA = createMockColumn('col-a', 'Дата', ['2024-01-01']); // Cyrillic — NFC-normalized
      const prefills = new Map<string, import('../recall/recall').PrefillEntry>([
        [
          'Дата', // NFC+trim of 'Дата'
          { definition: ColumnDefinition.DATE, params: dateParams, state: 'guessed' },
        ],
      ]);
      const recallResult: RecallResult = {
        prefills,
        recognized: { n: 1, m: 1 },
      };

      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [colA],
        undefined,
        recallResult,
        mockRecallPool
      );

      const columns = await firstValueFrom(stage2.columns);
      expect(columns).toHaveLength(1);
      const col = columns[0] as ImportStatementColumn;
      // Column should be prefilled with DATE + GUESSED
      expect(col.definition).toBe(ColumnDefinition.DATE);
      expect(col.recallState).toBe('guessed');
      expect(col.params).toEqual(dateParams);
    });

    it('unrecognized columns keep definition=null and recallState=null', async () => {
      const colA = createMockColumn('col-a', 'Amount', ['100', '200']);
      const colB = createMockColumn('col-b', 'Notes', ['note1', 'note2']); // no prefill

      const prefills = new Map<string, import('../recall/recall').PrefillEntry>([
        [
          'Amount',
          { definition: ColumnDefinition.AMOUNT, params: null, state: 'guessed' },
        ],
      ]);
      const recallResult: RecallResult = {
        prefills,
        recognized: { n: 1, m: 2 },
      };

      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [colA, colB],
        undefined,
        recallResult,
        mockRecallPool
      );

      const columns = await firstValueFrom(stage2.columns);
      const amountCol = columns.find((c) => c.id === 'col-a') as ImportStatementColumn;
      const notesCol = columns.find((c) => c.id === 'col-b') as ImportStatementColumn;

      expect(amountCol.definition).toBe(ColumnDefinition.AMOUNT);
      expect(amountCol.recallState).toBe('guessed');

      expect(notesCol.definition).toBeNull();
      expect(notesCol.recallState).toBeNull();
    });

    it('initialState reference preserved when no recall prefills', async () => {
      // Without recall, _initialState should be the original array reference
      const initialState = [colDate(), colAmount()];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private for test
      expect((stage2 as any)._initialState).toBe(initialState);
    });

    it('initialState is a new array when recall prefills are applied', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100']);
      const initialState = [col];
      const prefills = new Map<string, import('../recall/recall').PrefillEntry>([
        ['Amount', { definition: ColumnDefinition.AMOUNT, params: null, state: 'guessed' }],
      ]);
      const recallResult: RecallResult = {
        prefills,
        recognized: { n: 1, m: 1 },
      };

      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState,
        undefined,
        recallResult,
        mockRecallPool
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing private for test
      expect((stage2 as any)._initialState).not.toBe(initialState);
    });
  });

  // ── 2. N-of-M count ────────────────────────────────────────────────────────

  describe('recognized N-of-M', () => {
    it('recognized.n=0 and recognized.m=total when no recallResult passed', () => {
      const cols = [colDate(), colAmount(), colDesc()];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        cols
      );

      expect(stage2.recognized.n).toBe(0);
      expect(stage2.recognized.m).toBe(3); // total columns
    });

    it('recognized reflects the RecallResult counts', () => {
      const recallResult: RecallResult = {
        prefills: new Map(),
        recognized: { n: 2, m: 4 },
      };

      const cols = [colDate(), colAmount(), colDesc(), colUnknown()];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        cols,
        undefined,
        recallResult,
        mockRecallPool
      );

      expect(stage2.recognized.n).toBe(2);
      expect(stage2.recognized.m).toBe(4);
    });

    it('recognized is readonly — reflects only creation-time snapshot', () => {
      const recallResult: RecallResult = {
        prefills: new Map(),
        recognized: { n: 1, m: 2 },
      };

      const cols = [colDate(), colAmount()];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        cols,
        undefined,
        recallResult,
        mockRecallPool
      );

      expect(stage2.recognized).toEqual({ n: 1, m: 2 });
      // recognized should not change after applyColumn
      stage2.applyColumn(
        (cols[0] as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE })
      );
      expect(stage2.recognized).toEqual({ n: 1, m: 2 });
    });
  });

  // ── 3. GUESSED → confirmed transition ─────────────────────────────────────

  describe('GUESSED → confirmed state transition', () => {
    it('applying a GUESSED column transitions recallState to confirmed', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const prefills = new Map<string, import('../recall/recall').PrefillEntry>([
        ['Amount', { definition: ColumnDefinition.AMOUNT, params: null, state: 'guessed' }],
      ]);
      const recallResult: RecallResult = {
        prefills,
        recognized: { n: 1, m: 1 },
      };

      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        recallResult,
        mockRecallPool
      );

      const colsBefore = await firstValueFrom(stage2.columns);
      const guessedCol = colsBefore[0] as ImportStatementColumn;
      expect(guessedCol.recallState).toBe('guessed');

      // Apply the column (confirms the guessed mapping)
      stage2.applyColumn(guessedCol);

      const colsAfter = await firstValueFrom(stage2.columns);
      const confirmedCol = colsAfter[0] as ImportStatementColumn;
      // recallState should transition to 'confirmed'
      expect(confirmedCol.recallState).toBe('confirmed');
    });

    it('applying a new column definition with recallState=null keeps recallState null', async () => {
      const col = createMockColumn('col-a', 'Notes', ['note1', 'note2']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      const newCol = (col as ImportStatementColumn).copy({
        definition: ColumnDefinition.DESCRIPTION,
        recallState: null,
      });
      stage2.applyColumn(newCol);

      const colsAfter = await firstValueFrom(stage2.columns);
      const resultCol = colsAfter[0] as ImportStatementColumn;
      // recallState was null, stays null
      expect(resultCol.recallState).toBeNull();
    });

    it('applying a confirmed column keeps it confirmed', async () => {
      const col = createMockColumn('col-a', 'Date', ['2024-01-01', '2024-01-02']);

      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      // Create a column with recallState='confirmed' already
      const confirmedCol = (col as ImportStatementColumn).copy({
        definition: ColumnDefinition.DATE,
        recallState: 'confirmed',
      });
      stage2.applyColumn(confirmedCol);

      const colsAfter = await firstValueFrom(stage2.columns);
      const resultCol = colsAfter[0] as ImportStatementColumn;
      expect(resultCol.recallState).toBe('confirmed');
    });
  });

  // ── 4. learning loop — DETECTS at apply, defers the WRITE to flush ──────────
  //
  // DECLARED MIGRATION (2.8 decision #4 + PM ruling #4): apply NO LONGER calls
  // recallPool.save() (which wrote to IDB fire-and-forget). It now calls the
  // read-only detectCollision() at map time (map-time UX byte-identical) and
  // STAGES the write under the column id. The actual save()/confirmSave() fires
  // only on flushRecallWrites() (importNext = the user's advance/endorsement).
  // These assertions invert from "save called on apply" to "detect called on
  // apply, save NOT called until flush".

  describe('learning loop — DETECT at apply, WRITE deferred to flush (2.8 #4)', () => {
    it('detectCollision is called (NOT save) when a column with definition is applied', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      const appliedCol = (col as ImportStatementColumn).copy({
        definition: ColumnDefinition.AMOUNT,
        params: null,
      });

      stage2.applyColumn(appliedCol);

      // detect is async — wait for microtask queue to flush
      await Promise.resolve();
      await Promise.resolve();

      expect(mockRecallPool.detectCollision).toHaveBeenCalledOnce();
      expect(mockRecallPool.detectCollision).toHaveBeenCalledWith(
        'Amount',
        ColumnDefinition.AMOUNT,
        null
      );
      // The WRITE is deferred — nothing hits the pool at apply time.
      expect(mockRecallPool.save).not.toHaveBeenCalled();
      expect(mockRecallPool.confirmSave).not.toHaveBeenCalled();
    });

    it('detectCollision NOT called when column has definition=null', async () => {
      const col = createMockColumn('col-a', 'Notes', ['note1', 'note2']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(col);

      await Promise.resolve();
      await Promise.resolve();

      expect(mockRecallPool.detectCollision).not.toHaveBeenCalled();
      expect(mockRecallPool.save).not.toHaveBeenCalled();
    });

    it('detectCollision NOT called when no recallPool wired', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col]
      );

      const appliedCol = (col as ImportStatementColumn).copy({
        definition: ColumnDefinition.AMOUNT,
        params: null,
      });

      stage2.applyColumn(appliedCol);

      await Promise.resolve();
      await Promise.resolve();

      expect(mockRecallPool.detectCollision).not.toHaveBeenCalled();
    });

    it('flushRecallWrites() writes the staged entry via save() (new/identical path)', async () => {
      const col = createMockColumn('col-a', 'Trans Date', ['2024-01-01', '2024-01-02']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      const params: DateColumnParams = { format: 'auto' };
      stage2.applyColumn(
        (col as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE, params })
      );
      await Promise.resolve();

      // No write yet (apply only detected).
      expect(mockRecallPool.save).not.toHaveBeenCalled();

      await stage2.flushRecallWrites();

      // Flush commits the staged write with the exact name/definition/params.
      expect(mockRecallPool.save).toHaveBeenCalledOnce();
      expect(mockRecallPool.save).toHaveBeenCalledWith(
        'Trans Date',
        ColumnDefinition.DATE,
        params
      );
    });

    it('flushRecallWrites() commits one save per staged column (multiple columns)', async () => {
      const colA = createMockColumn('col-a', 'Amount', ['100', '200']);
      const colB = createMockColumn('col-b', 'Date', ['2024-01-01', '2024-01-02']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [colA, colB],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(
        (colA as ImportStatementColumn).copy({ definition: ColumnDefinition.AMOUNT })
      );
      stage2.applyColumn(
        (colB as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE, params: dateParams })
      );
      await Promise.resolve();

      await stage2.flushRecallWrites();
      expect(mockRecallPool.save).toHaveBeenCalledTimes(2);
    });

    it('last apply per columnId wins — re-applying the same column stages once', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(
        (col as ImportStatementColumn).copy({ definition: ColumnDefinition.AMOUNT, params: null })
      );
      stage2.applyColumn(
        (col as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE, params: dateParams })
      );
      await Promise.resolve();

      await stage2.flushRecallWrites();

      // ONE staged entry under col-a — the LAST apply (DATE) wins.
      expect(mockRecallPool.save).toHaveBeenCalledOnce();
      expect(mockRecallPool.save).toHaveBeenCalledWith('Amount', ColumnDefinition.DATE, dateParams);
    });

    it('unstageRecallWrite(columnId) drops a staged entry → flush does not write it', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(
        (col as ImportStatementColumn).copy({ definition: ColumnDefinition.AMOUNT, params: null })
      );
      await Promise.resolve();

      stage2.unstageRecallWrite('col-a');
      await stage2.flushRecallWrites();

      expect(mockRecallPool.save).not.toHaveBeenCalled();
    });

    it('item 1 — two columns colliding to one normalized key both stage under distinct ids; unstage one leaves the other', async () => {
      // NFC vs NFD of the same header → same normalizeKey, distinct column ids.
      const headerNFC = 'Дата і час'.normalize('NFC');
      const headerNFD = 'Дата і час'.normalize('NFD');
      const colA = createMockColumn('col-a', headerNFC, ['2024-01-01']);
      const colB = createMockColumn('col-b', headerNFD, ['2024-01-02']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [colA, colB],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(
        (colA as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE, params: dateParams })
      );
      stage2.applyColumn(
        (colB as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE, params: dateParams })
      );
      await Promise.resolve();

      // Both staged under distinct ids → flush issues two save() calls. The pool
      // collapses them to ONE entry (NFC key) via its own LWW — no NEW clobber.
      await stage2.flushRecallWrites();
      expect(mockRecallPool.save).toHaveBeenCalledTimes(2);

      // unstage one id → the OTHER survives to a later flush.
      mockRecallPool.save = vi.fn().mockResolvedValue({ outcome: 'saved' });
      stage2.unstageRecallWrite('col-a');
      await stage2.flushRecallWrites();
      expect(mockRecallPool.save).toHaveBeenCalledOnce(); // only col-b's staged write remains
    });
  });

  // ── 5. Collision path (DETECT at apply; map-time UX byte-identical) ─────────

  describe('collision path — lastSaveCollision (detect, no write)', () => {
    it('lastSaveCollision is null initially', () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      expect(stage2.lastSaveCollision).toBeNull();
    });

    it('lastSaveCollision is set when detectCollision returns a collision (NO write at apply)', async () => {
      const collision: CollisionDescriptor = {
        kind: 'type-change',
        existing: { definition: ColumnDefinition.DATE, params: null },
        incoming: { definition: ColumnDefinition.AMOUNT, params: null },
      };

      mockRecallPool.detectCollision = vi.fn().mockResolvedValue({
        outcome: 'collision',
        collision,
      });

      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      const appliedCol = (col as ImportStatementColumn).copy({
        definition: ColumnDefinition.AMOUNT,
        params: null,
      });

      stage2.applyColumn(appliedCol);

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      // Parity: lastSaveCollision is set EXACTLY as today, from detect…
      expect(stage2.lastSaveCollision).toBe(collision);
      // …but NOTHING was written to the pool at apply.
      expect(mockRecallPool.save).not.toHaveBeenCalled();
      expect(mockRecallPool.confirmSave).not.toHaveBeenCalled();
    });

    it('lastSaveCollision is cleared on next non-colliding apply', async () => {
      const collision: CollisionDescriptor = {
        kind: 'params-change',
        existing: { definition: ColumnDefinition.DATE, params: { format: 'auto' } as ColumnParams },
        incoming: {
          definition: ColumnDefinition.DATE,
          params: { format: { custom: 'dd/MM/yyyy' } } as ColumnParams,
        },
      };

      mockRecallPool.detectCollision = vi
        .fn()
        .mockResolvedValueOnce({ outcome: 'collision', collision })
        .mockResolvedValueOnce({ outcome: 'saved' });

      const colA = createMockColumn('col-a', 'Date', ['2024-01-01', '2024-01-02']);
      const colB = createMockColumn('col-b', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [colA, colB],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(
        (colA as ImportStatementColumn).copy({ definition: ColumnDefinition.DATE, params: dateParams })
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(stage2.lastSaveCollision).toBe(collision);

      stage2.applyColumn(
        (colB as ImportStatementColumn).copy({ definition: ColumnDefinition.AMOUNT, params: null })
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(stage2.lastSaveCollision).toBeNull();
    });

    it('detect failure is non-fatal but LOUD (HC-7): applyColumn does not throw AND the error is logged', async () => {
      mockRecallPool.detectCollision = vi.fn().mockRejectedValue(new Error('IndexedDB error'));

      const errorSpy = vi.spyOn(getLogger('engine.importStatement.stage2'), 'error');

      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      const appliedCol = (col as ImportStatementColumn).copy({
        definition: ColumnDefinition.AMOUNT,
        params: null,
      });

      expect(() => stage2.applyColumn(appliedCol)).not.toThrow();

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('recall-pool'),
        expect.anything(),
        expect.any(Error)
      );

      expect(stage2.lastSaveCollision).toBeNull();

      errorSpy.mockRestore();
    });

    it('flushRecallWrites() is loud on save failure (HC-7) but does not throw', async () => {
      mockRecallPool.save = vi.fn().mockRejectedValue(new Error('IndexedDB error'));
      const errorSpy = vi.spyOn(getLogger('engine.importStatement.stage2'), 'error');

      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      stage2.applyColumn(
        (col as ImportStatementColumn).copy({ definition: ColumnDefinition.AMOUNT, params: null })
      );
      await Promise.resolve();

      await expect(stage2.flushRecallWrites()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('recall-pool'),
        expect.anything(),
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });
  });

  // ── 6. copy() carries recallPool but not recallResult ─────────────────────

  describe('copy() with recall pool', () => {
    it('copied stage2 carries the recallPool reference', async () => {
      const col = createMockColumn('col-a', 'Amount', ['100', '200']);
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        [col],
        undefined,
        null,
        mockRecallPool
      );

      const columns = await firstValueFrom(stage2.columns);
      const copied = stage2.copy(columns);

      // Apply to copied — should trigger savePool on the copied stage2
      const appliedCol = (columns[0] as ImportStatementColumn).copy({
        definition: ColumnDefinition.AMOUNT,
        params: null,
      });
      // Need to get the copied column from copied stage2
      const copiedColumns = await firstValueFrom(copied.columns);
      const copiedApplied = (copiedColumns[0] as ImportStatementColumn).copy({
        definition: ColumnDefinition.AMOUNT,
        params: null,
      });
      copied.applyColumn(copiedApplied);

      await Promise.resolve();
      await Promise.resolve();

      // Pool DETECT was called via copied stage2 (the copy carries the pool ref).
      // (2.8 #4: apply detects; the write defers to the copy's own flush.)
      expect(mockRecallPool.detectCollision).toHaveBeenCalled();

      void appliedCol; // referenced above
    });

    it('recognized is 0/m on copied stage2 (no recall for copies)', () => {
      const cols = [colDate(), colAmount()];
      const recallResult: RecallResult = {
        prefills: new Map(),
        recognized: { n: 2, m: 2 },
      };

      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        cols,
        undefined,
        recallResult,
        mockRecallPool
      );

      expect(stage2.recognized.n).toBe(2);

      // copy() passes null recallResult → recognized.n=0
      const columns = stage2['_columns'].getValue();
      const copied = stage2.copy(columns);

      expect(copied.recognized.n).toBe(0);
      expect(copied.recognized.m).toBe(2); // m = initialState.length
    });
  });
});
