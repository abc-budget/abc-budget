/**
 * Core logic for the getUSDRatesBulk onRequest handler, extracted for testability.
 *
 * Like handleRatesRequest, this is a pure function of (req, res, deps) — all I/O is
 * injected via BulkHandlerDeps, so smoke tests can prove HANDLER ORDER and the
 * ONE-of-each I/O contract (one getAll, one cap-txn, one/chunked WriteBatch).
 *
 * Handler order (spec contract):
 *   1. Method guard       → 405 method-not-allowed
 *   2. Origin check       → 403 origin-* (reason from checkOrigin)
 *   3. Rate limit (1 tok) → 429 rate-limited
 *   4. Date-list validate → 400 invalid-argument (reject-any-invalid + non-empty + ≤MAX)
 *   5. De-dup → ONE getCached (getAll split hits/misses)
 *   6. ONE runBulkBudget (cap-by-K) → fetch only `allowed` of the sorted misses
 *   7. Bounded-concurrency OER fetch (pool=BULK_CONCURRENCY); per-date failure → omit
 *   8. ONE/chunked saveBatch → 200 { rates } (merged hits + fetched; cap-cut/failed omitted)
 *
 * Logging is SUMMARY-COUNTS ONLY — the per-request dates list is never logged (privacy).
 */

import * as logger from "firebase-functions/logger";
import { effectiveAllowlist } from "./origin.js";
import { validateDate, isDateInRange } from "./validate.js";

export const MAX_BULK_DATES = 366; // one year per request; the worker chunks beyond this
export const BULK_CONCURRENCY = 5; // bounded OER fetch pool

export interface BulkHandlerDeps {
    now: () => Date;
    checkOrigin: (
        origin: string | undefined,
        secFetchSite: string | undefined,
        allowlist: readonly string[]
    ) => { allowed: boolean; reason?: string };
    rateLimiterTake: (key: string, now: number) => boolean;
    /** ONE getAll over usd/{date} for the de-duped list → date→table for the HITS only. */
    getCached: (dates: string[]) => Promise<Map<string, Record<string, number>>>;
    /** ONE cap transaction: returns how many of `want` misses may be fetched (increment-by-K). */
    runBulkBudget: (now: Date, want: number) => Promise<number>;
    /** Fetch ONE date from OER (called via the bounded pool). Throws on failure. */
    fetchOER: (date: string) => Promise<Record<string, number>>;
    /** ONE WriteBatch (chunked ≤500) writing the fetched tables to usd/{date}. */
    saveBatch: (entries: { date: string; rates: Record<string, number> }[]) => Promise<void>;
}

export function validateDateList(dates: unknown, now: Date): dates is string[] {
    if (!Array.isArray(dates) || dates.length === 0 || dates.length > MAX_BULK_DATES) return false;
    return dates.every((d) => validateDate(d) && isDateInRange(d, now));
}

export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/**
 * Narrow request/response adapter types — a subset we need, so the handler is
 * testable with plain mocks AND assignable from the firebase-functions Request
 * (whose headers are IncomingHttpHeaders: string | string[] | undefined).
 */
export interface NarrowBulkReq {
    method: string;
    headers: Record<string, string | undefined> | { [key: string]: string | string[] | undefined };
    ip?: string;
    body: unknown;
}

export interface NarrowBulkRes {
    status(code: number): { json(data: unknown): unknown };
}

function getHeader(req: NarrowBulkReq, name: string): string | undefined {
    const v = (req.headers as Record<string, string | string[] | undefined>)[name];
    if (Array.isArray(v)) return v[0];
    return v;
}

export async function handleBulkRatesRequest(
    req: NarrowBulkReq,
    res: NarrowBulkRes,
    deps: BulkHandlerDeps
): Promise<void> {
    // ── 1. Method guard ──────────────────────────────────────────────────────
    if (req.method !== "POST") {
        res.status(405).json({ error: "method-not-allowed" });
        return;
    }

    // ── 2. Origin hard-reject ────────────────────────────────────────────────
    const originResult = deps.checkOrigin(
        getHeader(req, "origin"),
        getHeader(req, "sec-fetch-site"),
        effectiveAllowlist()
    );
    if (!originResult.allowed) {
        logger.warn("Origin rejected", { reason: originResult.reason });
        res.status(403).json({ error: originResult.reason ?? "origin-forbidden" });
        return;
    }

    // ── 3. Per-IP rate limit (one token for the whole batch) ─────────────────
    const nowMs = deps.now().getTime();
    if (!deps.rateLimiterTake(req.ip ?? "unknown", nowMs)) {
        res.status(429).json({ error: "rate-limited" });
        return;
    }

    // ── 4. Date-list validation (reject-any-invalid + non-empty + ≤MAX) ───────
    const now = deps.now();
    const body = req.body as Record<string, unknown> | null | undefined;
    if (!validateDateList(body?.dates, now)) {
        res.status(400).json({ error: "invalid-argument" });
        return;
    }

    // ── 5. De-dup → ONE getAll (split hits/misses) ───────────────────────────
    const requested = [...new Set(body!.dates as string[])]; // de-dup
    const cached = await deps.getCached(requested); // ONE getAll
    const misses = requested.filter((d) => !cached.has(d)).sort(); // deterministic subset order

    // ── 6. ONE cap-txn (increment-by-K) → fetch only `allowed` misses ────────
    const allowed = misses.length > 0 ? await deps.runBulkBudget(now, misses.length) : 0;
    const toFetch = misses.slice(0, allowed);

    // ── 7. Bounded-concurrency OER fetch; per-date failure → omit (best-effort) ─
    const fetched = (
        await mapWithConcurrency(toFetch, BULK_CONCURRENCY, async (date) => {
            try {
                return { date, rates: await deps.fetchOER(date) };
            } catch {
                return null; // per-date failure → omit, NOT a 500
            }
        })
    ).filter((x): x is { date: string; rates: Record<string, number> } => x !== null);

    // ── 8. ONE/chunked WriteBatch → merged response ──────────────────────────
    await deps.saveBatch(fetched); // ONE WriteBatch (chunked ≤500)

    const rates: Record<string, Record<string, number>> = {};
    for (const [date, table] of cached) rates[date] = table;
    for (const { date, rates: table } of fetched) rates[date] = table;

    logger.info("bulk rates", {
        requested: requested.length,
        cached: cached.size,
        fetched: fetched.length,
        saved: fetched.length,
        capCut: misses.length - allowed,
    }); // SUMMARY ONLY — no dates
    res.status(200).json({ rates });
}
