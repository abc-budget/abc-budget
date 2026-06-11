/**
 * PORT of `webapp/libs/engine/src/importStatement/stage1.spec.ts`.
 *
 * Mechanical adaptation (diff-audit):
 *   1. Imports: `@abc-budget/utils` → local utils/messages; all changed to relative.
 *   2. `jest.fn()` / `jest.Mocked<>` → `vi.fn()` / `vi.Mocked<>` (vitest).
 *   3. `createMock` helper inlined (no prior-art test-utils dep).
 *   4. `jest.Mock` cast → standard vitest cast.
 *   5. `import { firstValueFrom } from 'rxjs'` — retained verbatim.
 *   6. All assertions kept verbatim.
 *
 * Container wiring: none needed — stage1.spec.ts has no Container dep in prior art.
 * The mock service is constructed directly.
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { firstValueFrom } from 'rxjs';
import type { ImportStatementServiceInternal } from './service';
import { ImportStatementStage1Impl } from './stage1';
import type { ImportStatementStage2 } from './stage2/types';

// ── createMock helper (inlined — no prior-art test-utils dep) ────────────────

function createMock<T>(overrides: Partial<T> = {}): Mocked<T> {
  return overrides as Mocked<T>;
}

describe('ImportStatementStage1Impl', () => {
  // Mock service for testing
  let mockService: Mocked<
    Pick<ImportStatementServiceInternal, 'startWith' | 'stage2'>
  >;

  beforeEach(() => {
    mockService = createMock<
      Pick<ImportStatementServiceInternal, 'startWith' | 'stage2'>
    >({
      startWith: vi.fn(),
      stage2: vi.fn(),
    });
  });

  describe('constructor', () => {
    it('should extract columns from the first row', async () => {
      const data = [
        { col1: 'value1', col2: 'value2', col3: 'value3' },
        { col1: 'value4', col2: 'value5', col3: 'value6' },
      ];

      const stage1 = new ImportStatementStage1Impl(
        data,
        mockService as unknown as ImportStatementServiceInternal
      );
      const columns = await firstValueFrom(stage1.columns);
      expect(columns).toEqual(['col1', 'col2', 'col3']);
    });

    it('should throw an error if data is empty', () => {
      expect(
        () =>
          new ImportStatementStage1Impl(
            [],
            mockService as unknown as ImportStatementServiceInternal
          )
      ).toThrow('Import data cannot be empty');
    });

    it('should throw an error if rows have different numbers of columns', () => {
      const data = [
        { col1: 'value1', col2: 'value2', col3: 'value3' },
        { col1: 'value4', col2: 'value5' }, // Missing col3
      ];

      expect(
        () =>
          new ImportStatementStage1Impl(
            data,
            mockService as unknown as ImportStatementServiceInternal
          )
      ).toThrow('Row 1 has a different number of columns than the first row');
    });

    it('should throw an error if rows have different column names', () => {
      const data = [
        { col1: 'value1', col2: 'value2', col3: 'value3' },
        { col1: 'value4', col2: 'value5', col4: 'value6' }, // col4 instead of col3
      ];

      expect(
        () =>
          new ImportStatementStage1Impl(
            data,
            mockService as unknown as ImportStatementServiceInternal
          )
      ).toThrow('Row 1 is missing column "col3"');
    });
  });

  describe('getters', () => {
    it('should return the correct data from currentData getter', async () => {
      const data = [
        { col1: 'value1', col2: 'value2' },
        { col1: 'value3', col2: 'value4' },
      ];

      const stage1 = new ImportStatementStage1Impl(
        data,
        mockService as unknown as ImportStatementServiceInternal
      );
      const currentData = await firstValueFrom(stage1.currentData);
      expect(currentData).toEqual(data);
      // Ensure we're getting a copy, not the original reference
      expect(currentData).not.toBe(data);
    });

    it('should return the correct columns from columns getter', async () => {
      const data = [
        { col1: 'value1', col2: 'value2' },
        { col1: 'value3', col2: 'value4' },
      ];

      const stage1 = new ImportStatementStage1Impl(
        data,
        mockService as unknown as ImportStatementServiceInternal
      );
      const columns = await firstValueFrom(stage1.columns);
      expect(columns).toEqual(['col1', 'col2']);
    });
  });

  describe('next', () => {
    it('should call service.stage2 with itself', async () => {
      const data = [
        { col1: 'value1', col2: 'value2' },
        { col1: 'value3', col2: 'value4' },
      ];

      const mockStage2 = {} as ImportStatementStage2;
      (mockService.stage2 as ReturnType<typeof vi.fn>).mockResolvedValue(mockStage2);

      const stage1 = new ImportStatementStage1Impl(
        data,
        mockService as unknown as ImportStatementServiceInternal
      );
      const result = await stage1.next();

      expect(mockService.stage2).toHaveBeenCalledWith(stage1);
      expect(result).toBe(mockStage2);
    });
  });
});
