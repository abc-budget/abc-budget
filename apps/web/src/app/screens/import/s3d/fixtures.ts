import { vi } from 'vitest';
import type {
  CategoryDTO, CommitResultDTO, EngineClient, ReviewRowDTO, ReviewSummaryDTO, ReviewWindowDTO,
} from '@abc-budget/engine';

export function reviewRow(over: Partial<ReviewRowDTO> = {}): ReviewRowDTO {
  return {
    rowIndex: 0, state: 'ok', date: '2026-06-14T00:00:00.000Z', amount: 320.5,
    currency: 'UAH', description: 'АТБ МАРКЕТ', categoryId: 'groceries', isManual: 0, dup: false,
    ...over,
  };
}
export function summary(over: Partial<ReviewSummaryDTO> = {}): ReviewSummaryDTO {
  return { total: 1, ok: 1, error: 0, skipped: 0, dup: 0, newCount: 1, ...over };
}
export function reviewWindow(over: Partial<ReviewWindowDTO> = {}): ReviewWindowDTO {
  return { summary: summary(), rows: [reviewRow()], ...over };
}
export const CATS: CategoryDTO[] = [
  { id: 'groceries', name: 'Groceries', icon: 'groceries', currency: 'UAH' },
  { id: 'transport', name: 'Transport', icon: 'transport', currency: 'UAH' },
];
export function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    importReview: vi.fn(async (): Promise<ReviewWindowDTO> => reviewWindow()),
    importCommit: vi.fn(async (): Promise<CommitResultDTO> => ({ sessionId: 's', rowsCommitted: 1 })),
    categoriesList: vi.fn(async () => CATS),
    ...over,
  } as unknown as EngineClient;
}
