import {
  createDirectEngineClient,
  type EngineClient,
  type ExchangeRateApi,
} from '@abc-budget/engine';
import { createHttpRatesApi } from './app/rates/http-rates-api';

/** Try to construct the HTTP exchange rate API.
 *  If initialisation fails (e.g. env misconfiguration), degrade gracefully:
 *  log loudly and omit the api so the engine stays usable without rates (EP-3 carry-forward). */
function buildExchangeRateApi(): ExchangeRateApi | undefined {
  try {
    return createHttpRatesApi();
  } catch (err) {
    console.error(
      '[abc-budget] Failed to construct HttpRatesApi — exchange rate features unavailable:',
      err
    );
    return undefined;
  }
}

/** The app's EngineClient. Swapping to a worker means changing only this line (NFR-003). */
export const engine: EngineClient = createDirectEngineClient({
  exchangeRateApi: buildExchangeRateApi(),
});
