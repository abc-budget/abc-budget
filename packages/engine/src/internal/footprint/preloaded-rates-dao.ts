/**
 * An in-memory ExchangeRateDAO over a date→entity map, preloaded ONCE from the
 * real rates DAO for the commit's distinct operation dates. toAmountUSD /
 * CacheOnlyRatesApi read ONLY findByBaseCurrencyAndDate, so the per-row convert
 * hits memory (zero IDB reads) — the perf-map. Direction-correctness + the
 * RatesUnavailableError loud gate are preserved (an absent date returns null →
 * the cache-only read throws upstream, before any write).
 *
 * @module internal/footprint/preloaded-rates-dao
 * @internal
 */

import type { ExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateEntity, ExchangeRateKey } from '../exchange-rate/types';

/**
 * In-memory ExchangeRateDAO backed by a preloaded date→entity map.
 *
 * Only `findByBaseCurrencyAndDate` is live — it is the single method
 * `CacheOnlyRatesApi` (and therefore `toAmountUSD`) calls during the commit
 * pre-flight. All other Dao / ExchangeRateDAO members throw immediately; they
 * are never reached by the commit path, and loud failure prevents silent misuse.
 */
export class PreloadedRatesDao implements ExchangeRateDAO {
  constructor(private readonly byDate: ReadonlyMap<string, ExchangeRateEntity | null>) {}

  async findByBaseCurrencyAndDate(_base: string, date: string): Promise<ExchangeRateEntity | null> {
    return this.byDate.get(date) ?? null;
  }

  // The commit's cache-only read never calls these; fail loud if a future caller does.
  findByBaseCurrency(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  findByDate(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  create(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  read(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  update(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  upsert(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  delete(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  list(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  find(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  findByIndex(): never { throw new Error('PreloadedRatesDao: read-only by date'); }
  getAllKeys(): never { throw new Error('PreloadedRatesDao: read-only by date'); }

  // Satisfy the ExchangeRateKey / ExchangeRateEntity type parameters for tsc.
  // The above stubs cover every Dao<ExchangeRateKey, ExchangeRateEntity> member.
  declare private _key: ExchangeRateKey;
  declare private _entity: ExchangeRateEntity;
}
