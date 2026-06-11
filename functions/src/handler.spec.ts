/**
 * Smoke tests for handleRatesRequest — verify HANDLER ORDER and early-reject zero-I/O guarantees.
 *
 * Strategy: inject spy deps so that any I/O call (Firestore, OER fetch, budget check) throws if reached
 * — proving that earlier guards produce short-circuit responses.
 */
import { describe, it, expect, vi } from "vitest";
import { handleRatesRequest } from "./handler.js";
import type { HandlerDeps } from "./handler.js";

// ── tiny mock helpers ─────────────────────────────────────────────────────────

function makeReq(overrides: {
    method?: string;
    origin?: string;
    secFetchSite?: string;
    ip?: string;
    body?: unknown;
} = {}): { method: string; headers: Record<string, string | undefined>; ip: string; body: unknown } {
    const headers: Record<string, string | undefined> = {};
    if (overrides.origin !== undefined) headers["origin"] = overrides.origin;
    if (overrides.secFetchSite !== undefined) headers["sec-fetch-site"] = overrides.secFetchSite;
    return {
        method: overrides.method ?? "POST",
        headers,
        ip: overrides.ip ?? "1.2.3.4",
        body: overrides.body ?? { date: "2024-01-15" },
    };
}

function makeRes() {
    const res = {
        _status: 0,
        _json: null as unknown,
        statusCode: 0,
        status(code: number) { this._status = code; this.statusCode = code; return this; },
        json(data: unknown) { this._json = data; return this; },
    };
    return res;
}

/** Deps that EXPLODE if any I/O is attempted — used for early-reject tests */
function noIoDeps(): HandlerDeps {
    return {
        now: () => new Date("2026-06-11T12:00:00Z"),
        checkOrigin: () => { throw new Error("checkOrigin should not be called"); },
        rateLimiterTake: () => { throw new Error("rateLimiterTake should not be called"); },
        checkFirestore: () => { throw new Error("checkFirestore reached — I/O not expected"); },
        runBudgetTransaction: () => { throw new Error("runBudgetTransaction reached — I/O not expected"); },
        fetchOER: () => { throw new Error("fetchOER reached — I/O not expected"); },
        saveToFirestore: () => { throw new Error("saveToFirestore reached — I/O not expected"); },
    };
}

// ── ORDER: 1. Method guard (405) ───────────────────────────────────────────────
describe("handler order: method guard (405)", () => {
    it("returns 405 for GET — no origin/rate-limit/I/O checks", async () => {
        const req = makeReq({ method: "GET" });
        const res = makeRes();
        // All other deps explode; only method check runs.
        const deps = noIoDeps();
        // Unblock: method guard fires before checkOrigin is called
        deps.checkOrigin = () => { throw new Error("should not reach checkOrigin on 405"); };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(405);
        expect((res._json as { error: string }).error).toBe("method-not-allowed");
    });

    it("returns 405 for PUT", async () => {
        const req = makeReq({ method: "PUT" });
        const res = makeRes();
        await handleRatesRequest(req as never, res as never, noIoDeps());
        expect(res._status).toBe(405);
    });
});

// ── ORDER: 2. Origin guard (403) before rate-limit ────────────────────────────
describe("handler order: origin guard (403) before rate-limit", () => {
    it("returns 403 for missing origin — rate-limiter NOT called", async () => {
        const req = makeReq({ method: "POST" }); // no origin header
        const res = makeRes();

        const rateLimiterSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: (origin, _sfs, _list) => {
                if (!origin) return { allowed: false, reason: "origin-missing" };
                return { allowed: true };
            },
            rateLimiterTake: rateLimiterSpy,
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(403);
        expect((res._json as { error: string }).error).toBe("origin-missing");
        expect(rateLimiterSpy).not.toHaveBeenCalled();
    });

    it("returns 403 for forbidden origin — rate-limiter NOT called", async () => {
        const req = makeReq({ method: "POST", origin: "https://evil.example.com" });
        const res = makeRes();

        const rateLimiterSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: false, reason: "origin-forbidden" }),
            rateLimiterTake: rateLimiterSpy,
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(403);
        expect(rateLimiterSpy).not.toHaveBeenCalled();
    });
});

// ── ORDER: 3. Rate-limit guard (429) before date validation ───────────────────
describe("handler order: rate-limit guard (429) before date validation", () => {
    it("returns 429 when rate-limiter denies — no Firestore touch", async () => {
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: { date: "NOT-A-DATE" }, // invalid date; but rate limit fires first
        });
        const res = makeRes();

        const firestoreSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => false, // deny
            checkFirestore: firestoreSpy,
            runBudgetTransaction: firestoreSpy,
            fetchOER: firestoreSpy,
            saveToFirestore: firestoreSpy,
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(429);
        expect((res._json as { error: string }).error).toBe("rate-limited");
        expect(firestoreSpy).not.toHaveBeenCalled();
    });
});

// ── ORDER: 4. Date validation (400) before any Firestore touch ────────────────
describe("handler order: date validation (400) before Firestore", () => {
    it("returns 400 for invalid date — Firestore NOT called", async () => {
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: { date: "NOT-A-DATE" },
        });
        const res = makeRes();

        const firestoreSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => true, // allow
            checkFirestore: firestoreSpy,
            runBudgetTransaction: firestoreSpy,
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(400);
        expect((res._json as { error: string }).error).toBe("invalid-argument");
        expect(firestoreSpy).not.toHaveBeenCalled();
    });

    it("returns 400 for out-of-range date — Firestore NOT called", async () => {
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: { date: "1990-01-01" }, // before 1999
        });
        const res = makeRes();

        const firestoreSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => true,
            checkFirestore: firestoreSpy,
            runBudgetTransaction: firestoreSpy,
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(400);
        expect(firestoreSpy).not.toHaveBeenCalled();
    });

    it("returns 400 for missing date field — Firestore NOT called", async () => {
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: {},
        });
        const res = makeRes();

        const firestoreSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => true,
            checkFirestore: firestoreSpy,
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(400);
        expect(firestoreSpy).not.toHaveBeenCalled();
    });
});

// ── ORDER: 5. Cache hit → 200 without budget/OER touch ────────────────────────
describe("handler order: cache hit returns 200 without budget/OER", () => {
    it("returns 200 with cached rates when Firestore has data", async () => {
        const cachedRates = { USD: 1, EUR: 0.85 };
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: { date: "2024-01-15" },
        });
        const res = makeRes();

        const budgetSpy = vi.fn();
        const oerSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => true,
            checkFirestore: async () => cachedRates,
            runBudgetTransaction: budgetSpy,
            fetchOER: oerSpy,
            saveToFirestore: async () => {},
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(200);
        expect((res._json as { rates: unknown }).rates).toEqual(cachedRates);
        expect(budgetSpy).not.toHaveBeenCalled();
        expect(oerSpy).not.toHaveBeenCalled();
    });
});

// ── ORDER: 6. Budget cap (429 resource-exhausted) before OER ─────────────────
describe("handler order: budget cap (429) before OER fetch", () => {
    it("returns 429 resource-exhausted when budget is exhausted — OER NOT called", async () => {
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: { date: "2024-01-15" },
        });
        const res = makeRes();

        const oerSpy = vi.fn();
        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => true,
            checkFirestore: async () => null, // cache miss
            runBudgetTransaction: async () => false, // budget exhausted
            fetchOER: oerSpy,
            saveToFirestore: async () => {},
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(429);
        expect((res._json as { error: string }).error).toBe("resource-exhausted");
        expect(oerSpy).not.toHaveBeenCalled();
    });
});

// ── ORDER: 7. OER failure → 500 ───────────────────────────────────────────────
describe("handler order: OER failure → 500", () => {
    it("returns 500 when OER throws — no internals leaked", async () => {
        const req = makeReq({
            method: "POST",
            origin: "https://abc-budget-2d379.web.app",
            body: { date: "2024-01-15" },
        });
        const res = makeRes();

        const deps: HandlerDeps = {
            ...noIoDeps(),
            checkOrigin: () => ({ allowed: true }),
            rateLimiterTake: () => true,
            checkFirestore: async () => null,
            runBudgetTransaction: async () => true,
            fetchOER: async () => { throw new Error("network failure details MUST NOT LEAK"); },
            saveToFirestore: async () => {},
        };

        await handleRatesRequest(req as never, res as never, deps);

        expect(res._status).toBe(500);
        const body = res._json as { error: string };
        expect(body.error).toBe("internal");
        // Internal details must NOT be in the response body
        expect(JSON.stringify(body)).not.toContain("network failure");
        expect(JSON.stringify(body)).not.toContain("MUST NOT LEAK");
    });
});
