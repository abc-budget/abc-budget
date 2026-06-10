import {
  createDirectEngineClient,
  type EngineClient,
  type ExchangeRateApi,
} from '@abc-budget/engine';
import { createFirebaseRatesApi } from './app/rates/firebase-rates-api';

/** Try to construct the Firebase exchange rate API.
 *  If initialisation fails (e.g. wrong build-time config), degrade gracefully:
 *  log loudly and omit the api so the engine stays usable without rates (EP-3 carry-forward). */
function buildExchangeRateApi(): ExchangeRateApi | undefined {
  try {
    return createFirebaseRatesApi();
  } catch (err) {
    console.error(
      '[abc-budget] Failed to construct FirebaseRatesApi — exchange rate features unavailable:',
      err
    );
    return undefined;
  }
}

/** The app's EngineClient. Swapping to a worker means changing only this line (NFR-003). */
export const engine: EngineClient = createDirectEngineClient({
  exchangeRateApi: buildExchangeRateApi(),
});
