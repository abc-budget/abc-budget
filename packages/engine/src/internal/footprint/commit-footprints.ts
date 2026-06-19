/**
 * The footprint commit path — two-phase, fail-loud, all-or-nothing (Story 3.4 Task 3).
 * @module internal/footprint/commit-footprints
 * @internal
 *
 * TWO-PHASE RATIONALE: a footprint commit either lands COMPLETELY or not at all.
 * The whole batch is converted to USD in a PURE pre-flight (no store writes) BEFORE
 * a single row is persisted, so a single uncached rate aborts the WHOLE commit with
 * ZERO writes — the `RatesUnavailableError` propagates out of the pre-flight before
 * `putBatch` is ever reached. The write itself is one atomic `putBatch` transaction.
 * Re-committing is safe: the native [hash,year,month] upsert overwrites in place
 * (last write wins), so the same rows committed twice yield the same store.
 *
 * Deterministic: the only network touch is `warm`, and that is best-effort — a
 * network/HTTP rejection is SWALLOWED. The cache-only convert below is the single
 * canonical loud gate; if a rate is genuinely missing, the convert fails loud (not
 * the warm).
 */

import { toAmountUSD } from './footprint-usd';
import { deriveFootprint } from './derive-footprint';
import { PreloadedRatesDao } from './preloaded-rates-dao';
import type { FootprintDao } from './footprint-dao';
import type { FootprintRecord } from './types';
import type { ExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateEntity } from '../exchange-rate/types';
import type { TransactionRow } from '../importStatement/stage3/types';

/**
 * Collaborators for {@link commitFootprints}.
 */
export interface CommitFootprintsDeps {
  /** The footprint store — receives the atomic `putBatch` write. */
  footprintDao: FootprintDao;
  /** The rate cache the USD convert reads (cache-only; a miss fails loud). */
  ratesDao: ExchangeRateDAO;
  /** Best-effort rate warm for the distinct operation dates. May reject (swallowed). */
  warm: (dates: Date[]) => Promise<void>;
  /**
   * 5.1: per-row categorization. Defaults to derived (null/0) — the EP-3 raw behavior,
   * so all existing specs remain green with no change.
   */
  categoryOf?: (row: TransactionRow) => { categoryId: string | null; isManual: 0 | 1 };
}

/**
 * Result of a successful commit.
 */
export interface CommitResult {
  /** Number of footprint rows written in the batch. */
  written: number;
}

/**
 * Distinct operation dates (UTC yyyy-MM-dd) across the rows, preserving first-seen
 * order. Keyed by `date.toISOString().split('T')[0]` — the SAME key the rate cache
 * uses — so warm and the convert agree on the calendar day.
 */
function distinctOpDates(rows: readonly TransactionRow[]): Date[] {
  const seen = new Set<string>();
  const dates: Date[] = [];
  for (const row of rows) {
    const key = row.date.toISOString().split('T')[0];
    if (!seen.has(key)) {
      seen.add(key);
      dates.push(row.date);
    }
  }
  return dates;
}

/**
 * Commits footprint rows for a batch of transactions — two-phase, all-or-nothing.
 *
 * Orchestration:
 *  1. WARM (best-effort): `await deps.warm(distinctOpDates(rows))`, wrapped so a
 *     network/HTTP rejection is SWALLOWED. The convert below is the loud gate.
 *  2. PRE-FLIGHT (PURE — NO writes yet): convert every row to USD via the cache-only
 *     `toAmountUSD` and derive its `FootprintRecord`. If ANY convert throws
 *     `RatesUnavailableError`, it PROPAGATES — and because no write has happened yet,
 *     the store is untouched (ZERO writes).
 *  3. WRITE: persist the whole batch in ONE atomic `putBatch` transaction.
 *
 * @param rows - The stage-3 transaction rows to commit.
 * @param deps - The footprint DAO, rate cache, and best-effort warm fn.
 * @returns The number of rows written.
 * @throws {import('../exchange-rate/cache-only-rates-api').RatesUnavailableError}
 *   If any row's rate is uncached — the whole commit aborts with ZERO writes.
 */
export async function commitFootprints(
  rows: readonly TransactionRow[],
  deps: CommitFootprintsDeps
): Promise<CommitResult> {
  const distinct = distinctOpDates(rows);

  // 1. WARM — best-effort. A network/HTTP rejection is swallowed; the cache-only
  //    convert below is the single canonical loud gate.
  try {
    await deps.warm(distinct);
  } catch {
    // Swallowed by design — warm is best-effort. If a rate is truly missing the
    // pre-flight convert (step 2) fails loud, not here.
  }

  // PERF-MAP: preload the distinct-date USD rate tables ONCE (M reads, not N).
  // An absent date stores null, which makes CacheOnlyRatesApi throw
  // RatesUnavailableError in the pre-flight below — before any putBatch write.
  const byDate = new Map<string, ExchangeRateEntity | null>();
  for (const date of distinct) {
    const key = date.toISOString().split('T')[0];
    if (!byDate.has(key)) byDate.set(key, await deps.ratesDao.findByBaseCurrencyAndDate('USD', key));
  }
  const ratesReader = new PreloadedRatesDao(byDate);

  // 2. PRE-FLIGHT — PURE (reads memory via ratesReader — ZERO per-row IDB reads).
  //    Convert + derive EVERY row before any write. A cache miss throws
  //    RatesUnavailableError here and propagates; no row has been persisted yet,
  //    so the store stays untouched (the two-phase guarantee).
  const records: FootprintRecord[] = [];
  for (const row of rows) {
    const amountUSD = await toAmountUSD(row.amount, row.currency, row.date, ratesReader);
    const cat = deps.categoryOf
      ? deps.categoryOf(row)
      : { categoryId: null as string | null, isManual: 0 as const };
    records.push(deriveFootprint(row, amountUSD, cat.categoryId, cat.isManual));
  }

  // 3. WRITE — one atomic transaction. Reached only when every convert succeeded.
  await deps.footprintDao.putBatch(records);

  return { written: records.length };
}
