/**
 * Core logic for the getUSDRates onRequest handler, extracted for testability.
 *
 * The handler is a pure function of (req, res, deps) — all I/O is injected via HandlerDeps.
 * This allows smoke tests to verify HANDLER ORDER and prove that early rejects produce
 * zero I/O (by injecting spy deps that throw if called unexpectedly).
 *
 * Handler order (spec contract):
 *   1. Method guard   → 405 method-not-allowed
 *   2. Origin check   → 403 origin-missing | origin-forbidden | sec-fetch-site-cross
 *   3. Rate limit     → 429 rate-limited
 *   4. Date validate  → 400 invalid-argument
 *   5. Firestore cache → 200 { rates } (cache hit, no budget/OER touch)
 *   6. Budget cap     → 429 resource-exhausted
 *   7. OER fetch      → 500 internal (on failure) | continue to save + 200
 *   8. Save + return  → 200 { rates }
 */

import * as logger from "firebase-functions/logger";
import { validateDate, isDateInRange } from "./validate.js";
import { PROD_ORIGIN_ALLOWLIST } from "./origin.js";

export interface HandlerDeps {
    /** Returns the current time (injected for testability). */
    now: () => Date;

    /** Checks origin acceptability. */
    checkOrigin: (
        origin: string | undefined,
        secFetchSite: string | undefined,
        allowlist: readonly string[]
    ) => { allowed: boolean; reason?: string };

    /** Attempts to consume one rate-limit token for the given key. */
    rateLimiterTake: (key: string, now: number) => boolean;

    /** Reads cached rates from Firestore. Returns null on cache miss. */
    checkFirestore: (date: string) => Promise<Record<string, number> | null>;

    /** Runs the transactional budget check-and-increment. Returns true if allowed. */
    runBudgetTransaction: (now: Date) => Promise<boolean>;

    /** Fetches rates from OER. Throws on any failure. */
    fetchOER: (date: string) => Promise<Record<string, number>>;

    /** Saves rates to Firestore. */
    saveToFirestore: (date: string, rates: Record<string, number>) => Promise<void>;
}

/**
 * Thin request/response adapter types — narrow subset we need, so the function is
 * testable with plain mock objects without importing firebase-functions.
 */
export interface NarrowReq {
    method: string;
    headers: Record<string, string | undefined> | { [key: string]: string | string[] | undefined };
    ip?: string;
    body: unknown;
}

export interface NarrowRes {
    status(code: number): NarrowRes;
    json(data: unknown): NarrowRes;
}

function getHeader(req: NarrowReq, name: string): string | undefined {
    const v = (req.headers as Record<string, string | string[] | undefined>)[name];
    if (Array.isArray(v)) return v[0];
    return v;
}

export async function handleRatesRequest(
    req: NarrowReq,
    res: NarrowRes,
    deps: HandlerDeps
): Promise<void> {
    // ── 1. Method guard ──────────────────────────────────────────────────────
    if (req.method !== "POST") {
        res.status(405).json({ error: "method-not-allowed" });
        return;
    }

    // ── 2. Origin hard-reject ────────────────────────────────────────────────
    const origin = getHeader(req, "origin");
    const secFetchSite = getHeader(req, "sec-fetch-site");
    const originResult = deps.checkOrigin(origin, secFetchSite, PROD_ORIGIN_ALLOWLIST);
    if (!originResult.allowed) {
        logger.warn("Origin rejected", { reason: originResult.reason });
        res.status(403).json({ error: originResult.reason ?? "origin-forbidden" });
        return;
    }

    // ── 3. Per-IP rate limit ─────────────────────────────────────────────────
    // req.ip is set by Cloud Functions via X-Forwarded-For (the first untrusted hop).
    const ip = req.ip ?? "unknown";
    const nowMs = deps.now().getTime();
    if (!deps.rateLimiterTake(ip, nowMs)) {
        logger.warn("Rate limit exceeded", { ip });
        res.status(429).json({ error: "rate-limited" });
        return;
    }

    // ── 4. Date validation ───────────────────────────────────────────────────
    const body = req.body as Record<string, unknown> | null | undefined;
    const date = body?.date;

    if (!validateDate(date)) {
        logger.error("Invalid date parameter in getUSDRates");
        res.status(400).json({ error: "invalid-argument" });
        return;
    }

    const now = deps.now();
    if (!isDateInRange(date, now)) {
        logger.error("Date out of allowed range in getUSDRates", { date });
        res.status(400).json({ error: "invalid-argument" });
        return;
    }

    logger.info("Processing USD rates request", { date });

    // ── 5. Firestore cache ───────────────────────────────────────────────────
    const cached = await deps.checkFirestore(date);
    if (cached) {
        logger.info("Cache hit — OK");
        res.status(200).json({ rates: cached });
        return;
    }

    // ── 6. Budget cap (transactional) ────────────────────────────────────────
    const budgetAllowed = await deps.runBudgetTransaction(now);
    if (!budgetAllowed) {
        logger.error("Monthly OER budget exhausted");
        res.status(429).json({ error: "resource-exhausted" });
        return;
    }

    // ── 7. OER fetch ─────────────────────────────────────────────────────────
    let rates: Record<string, number>;
    try {
        rates = await deps.fetchOER(date);
    } catch (err) {
        logger.error("Error fetching data from Open Exchange Rates", err);
        res.status(500).json({ error: "internal" });
        return;
    }

    // ── 8. Save + return ─────────────────────────────────────────────────────
    await deps.saveToFirestore(date, rates);
    logger.info("OK");
    res.status(200).json({ rates });
}
