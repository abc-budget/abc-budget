/**
 * Firebase implementation of ExchangeRateApi.
 *
 * Calls the `getUSDRates` Firebase callable function (europe-west1) with App Check.
 * If the App Check site key env var is absent, App Check initialisation is skipped
 * and a loud console.error is emitted so the founder notices immediately.
 *
 * TODO-FOUNDER: set VITE_APPCHECK_SITE_KEY to the reCAPTCHA Enterprise site key for
 *   project abc-budget-2d379 before deploying to production.  App Check is disabled
 *   (and the function will reject requests) until this key is provided.
 *
 * Public Firebase project config for abc-budget-2d379 (not secret — safe to commit):
 *   https://firebase.google.com/docs/web/setup#config-object
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import type { ExchangeRateApi } from '@abc-budget/engine';

// ---------------------------------------------------------------------------
// Public Firebase project config (abc-budget-2d379)
// These values are safe to commit — they are the client-side identifiers only.
// TODO-FOUNDER: verify these match your Firebase console → Project settings → Web apps.
// ---------------------------------------------------------------------------
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyPLACEHOLDER-TODO-FOUNDER-fill-in',
  authDomain: 'abc-budget-2d379.firebaseapp.com',
  projectId: 'abc-budget-2d379',
  storageBucket: 'abc-budget-2d379.appspot.com',
  messagingSenderId: 'TODO-FOUNDER-fill-in',
  appId: 'TODO-FOUNDER-fill-in',
};

const FUNCTIONS_REGION = 'europe-west1';
const CALLABLE_NAME = 'getUSDRates';

let _app: FirebaseApp | null = null;

function getOrInitApp(): FirebaseApp {
  if (_app) return _app;

  // Re-use an already-initialised Firebase app (e.g. during HMR or tests).
  const existing = getApps().find((a) => a.name === '[DEFAULT]');
  if (existing) {
    _app = existing;
    return _app;
  }

  _app = initializeApp(FIREBASE_CONFIG);

  // App Check — required for the callable to accept requests in production.
  const siteKey = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined;
  if (siteKey && siteKey !== 'undefined') {
    initializeAppCheck(_app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } else {
    // Loud-fail: make this impossible to miss in the console.
    console.error(
      '[abc-budget] VITE_APPCHECK_SITE_KEY is not set. ' +
        'Firebase App Check is DISABLED — the getUSDRates callable will reject requests in production. ' +
        'Set the reCAPTCHA Enterprise site key for project abc-budget-2d379 in your .env file.'
    );
  }

  return _app;
}

/** Formats a Date to "yyyy-MM-dd" for the function payload. */
function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

class FirebaseRatesApi implements ExchangeRateApi {
  async getExchangeRate(
    baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>> {
    const app = getOrInitApp();
    const functions = getFunctions(app, FUNCTIONS_REGION);
    const callable = httpsCallable<{ date: string }, Record<string, number>>(
      functions,
      CALLABLE_NAME
    );

    const dateStr = toDateString(date);

    let result: Record<string, number>;
    try {
      const response = await callable({ date: dateStr });
      result = response.data;
    } catch (err) {
      // Throw loudly — no silent fallback (per arch decision: fail-loud carry-forward EP-3).
      console.error(
        `[abc-budget] Failed to fetch exchange rates for ${baseCurrency} on ${dateStr}:`,
        err
      );
      throw err;
    }

    if (!result || typeof result !== 'object') {
      throw new Error(
        `[abc-budget] getUSDRates returned unexpected payload for ${dateStr}: ${JSON.stringify(result)}`
      );
    }

    return result;
  }
}

/** Factory — creates the Firebase-backed ExchangeRateApi. */
export function createFirebaseRatesApi(): ExchangeRateApi {
  return new FirebaseRatesApi();
}
