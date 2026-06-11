/**
 * Origin hard-reject helper for the getUSDRates onRequest handler.
 *
 * The production allowlist is the single source of truth — no localhost, no HTTP.
 * Spoofability is documented (curl can fake Origin) — these checks are browser-mediated
 * abuse/cost-control filters, not access-control gates.  See ENT-004.
 */

export const PROD_ORIGIN_ALLOWLIST: readonly string[] = [
    "https://abc-budget-2d379.web.app",
    "https://abc-budget-2d379.firebaseapp.com",
];

/**
 * Emulator-hosting origins added only when running inside the Firebase Emulator Suite.
 * process.env.FUNCTIONS_EMULATOR is set to "true" automatically by the emulator runtime
 * itself — it is never present in deployed (production) Cloud Functions.
 * This keeps the prod allowlist prod-only by construction (ENT-004).
 */
const EMULATOR_ORIGIN_ALLOWLIST: readonly string[] = [
    "http://localhost:5000",
    "http://127.0.0.1:5000",
];

/**
 * Returns the effective origin allowlist for the current runtime environment.
 * In production (FUNCTIONS_EMULATOR absent) this is identical to PROD_ORIGIN_ALLOWLIST.
 * In the emulator (FUNCTIONS_EMULATOR === 'true') the two emulator-hosting origins are
 * appended, enabling the browser dev path described in functions/README.md.
 */
export function effectiveAllowlist(): readonly string[] {
    if (process.env.FUNCTIONS_EMULATOR === "true") {
        return [...PROD_ORIGIN_ALLOWLIST, ...EMULATOR_ORIGIN_ALLOWLIST];
    }
    return PROD_ORIGIN_ALLOWLIST;
}

export interface OriginCheckResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Checks whether the request origin is acceptable.
 *
 * Decision table (in priority order):
 *  1. Origin missing/empty           → { allowed: false, reason: 'origin-missing' }
 *  2. Sec-Fetch-Site present AND
 *     NOT 'same-origin'/'same-site'  → { allowed: false, reason: 'sec-fetch-site-cross' }
 *     (forbidden-header class — browsers cannot forge this value)
 *  3. Origin not in allowlist        → { allowed: false, reason: 'origin-forbidden' }
 *  4. All checks pass                → { allowed: true }
 *
 * Absent Sec-Fetch-Site is tolerated (older user-agents/non-browser clients that also
 * provide a valid Origin).
 *
 * @param origin       Value of the `Origin` request header (or undefined if absent).
 * @param secFetchSite Value of the `Sec-Fetch-Site` request header (or undefined if absent).
 * @param allowlist    The list of accepted origin strings to check against.
 */
export function checkOrigin(
    origin: string | undefined,
    secFetchSite: string | undefined,
    allowlist: readonly string[]
): OriginCheckResult {
    // 1. Origin must be present and non-empty
    if (!origin) {
        return { allowed: false, reason: "origin-missing" };
    }

    // 2. Sec-Fetch-Site present but NOT same-origin or same-site → hard reject
    if (secFetchSite !== undefined) {
        if (secFetchSite !== "same-origin" && secFetchSite !== "same-site") {
            return { allowed: false, reason: "sec-fetch-site-cross" };
        }
    }

    // 3. Origin must be in the allowlist
    if (!allowlist.includes(origin)) {
        return { allowed: false, reason: "origin-forbidden" };
    }

    return { allowed: true };
}
