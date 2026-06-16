/**
 * The S3c best-effort remainder magnitude — Story 4.6 Task 3 (decision B).
 * @module internal/rules/remainder-magnitude
 * @internal
 *
 * Sums the still-uncategorized remainder into the user's base currency so the
 * dialog can show «≈ N UAH (+ 320 ₴ uncached)». This is an INFORM-DON'T-GATE
 * signal (ENT-021): there is NO threshold and NO gate — the number never blocks
 * «Решту → Інше». It is best-effort by construction.
 *
 * RATE DATE = the OPERATION date `row.date` (NOT today, NOT a batch date) —
 * consistent with `deriveFootprint` / `footprint-usd` UTC operation-date keying,
 * and exactly the key `CacheOnlyRatesApi` reads. Same-currency and any
 * already-cached operation date convert exactly.
 *
 * `warmRates` is EP-5, so PRE-COMMIT the operation-date rates are frequently
 * UNcached — expect a FATTER `uncachedTail` at S3c. That fat tail is the designed
 * best-effort signal, not a failure.
 *
 * FAIL-SOFT (unlike the EP-5 commit's fail-LOUD `toAmountUSD`): a row whose rate
 * is uncached is bucketed into `uncachedTail` keyed by its currency; the whole
 * call STILL RESOLVES so the dialog still opens.
 *
 * The swallow gotcha (verified — see `footprint/footprint-usd.ts`): a cache miss
 * surfaces as `RatesUnavailableError` from `CacheOnlyRatesApi.getExchangeRate`,
 * but `ExchangeRateServiceImpl.convert` wraps every rate lookup in a try/catch
 * that logs and returns null, so the miss reaches the caller DOWNGRADED to a
 * generic `Error('Cannot convert from X to Y')` — the precise type is lost. To
 * keep fail-soft alive through the `ExchangeRateService` seam we treat BOTH the
 * precise `RatesUnavailableError` (should a converter propagate it) AND that
 * convert "Cannot convert" wrapper (the actual `ExchangeRateServiceImpl` runtime
 * case — a cache miss is the ONLY reason every strategy returns null over a
 * cache-only api) as the uncached signal. Any OTHER error rethrows.
 */

import { RatesUnavailableError } from '../exchange-rate/cache-only-rates-api';
import type { ExchangeRateService } from '../exchange-rate/service';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';

/**
 * The best-effort base-currency magnitude of the remainder.
 */
export interface RemainderMagnitude {
  /** Number of remainder operations summed (`remainderRows.length`). */
  opCount: number;
  /**
   * Best-effort sum in the base currency of every remainder row whose rate was
   * available (same-currency rows added verbatim; cross-currency rows converted
   * at the OPERATION date). Uncached rows are NOT in here — they are in the tail.
   */
  baseTotal: number;
  /**
   * Per-currency sum of the rows whose operation-date rate was UNcached, in
   * their ORIGINAL currency (NOT converted). Keyed by currency code. The
   * dialog shows this as the «… + 320 ₴ uncached» best-effort signal.
   */
  uncachedTail: Map<string, number>;
}

/**
 * The convert swallow-wrapper message prefix (from `ExchangeRateServiceImpl`):
 * `Cannot convert from ${from} to ${to}`. Over a cache-only api the SOLE reason
 * every conversion strategy returns null is a `RatesUnavailableError` miss, so
 * this wrapper is the runtime stand-in for the uncached signal.
 */
const CONVERT_UNAVAILABLE_PREFIX = 'Cannot convert from ';

/** True when `e` is the uncached/unconvertible signal (precise OR swallow-wrapped). */
function isUncachedSignal(e: unknown): boolean {
  return (
    e instanceof RatesUnavailableError ||
    (e instanceof Error && e.message.startsWith(CONVERT_UNAVAILABLE_PREFIX))
  );
}

/**
 * Computes the best-effort base-currency magnitude of the remainder (FAIL-SOFT).
 *
 * Per row: same-currency rows add their amount to `baseTotal` with no
 * conversion; cross-currency rows convert at `row.date` (the operation date).
 * A row whose rate is uncached is bucketed into `uncachedTail` (keyed by
 * currency, in its original amount) and the call STILL RESOLVES. Any non-rates
 * error rethrows.
 *
 * @param remainderRows - The still-uncategorized rows to size.
 * @param deps - `ratesService` (an `ExchangeRateServiceImpl` over
 *   `CacheOnlyRatesApi` — offline) and the user's `base` currency code.
 * @returns The `RemainderMagnitude` (opCount, baseTotal, per-currency tail).
 */
export async function computeRemainderMagnitude(
  remainderRows: readonly ImportStatementStage3Row[],
  deps: { ratesService: ExchangeRateService; base: string }
): Promise<RemainderMagnitude> {
  const opCount = remainderRows.length;
  let baseTotal = 0;
  const uncachedTail = new Map<string, number>();

  for (const row of remainderRows) {
    // Same currency as base: no conversion, no rate lookup, always exact.
    if (row.currency === deps.base) {
      baseTotal += row.amount;
      continue;
    }

    try {
      // Rate DATE = the OPERATION date (UTC operation-date keying).
      baseTotal += await deps.ratesService.convert(
        row.amount,
        row.currency,
        deps.base,
        row.date
      );
    } catch (e) {
      // FAIL-SOFT only on the uncached signal — bucket into the tail and carry on.
      if (isUncachedSignal(e)) {
        uncachedTail.set(
          row.currency,
          (uncachedTail.get(row.currency) ?? 0) + row.amount
        );
      } else {
        // Any other error is unexpected — rethrow (the soft path is uncached-only).
        throw e;
      }
    }
  }

  return { opCount, baseTotal, uncachedTail };
}
