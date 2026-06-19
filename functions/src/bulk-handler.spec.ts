/**
 * Smoke tests for handleBulkRatesRequest — verify HANDLER ORDER, the ONE-of-each
 * I/O guarantees (one getAll, one cap-txn, one WriteBatch), best-effort partial
 * mapping, bounded-concurrency fetching, and summary-only (no-dates) logging.
 *
 * Strategy mirrors handler.spec.ts: inject spy deps and assert call counts/order.
 */
import { describe, it, expect, vi } from "vitest";
import * as logger from "firebase-functions/logger";

// Mock the logger so we can capture every call's arguments and assert that the
// per-request dates list never appears in any log line (privacy). ESM module
// namespaces are not configurable, so vi.spyOn cannot be used here.
vi.mock("firebase-functions/logger", () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

import {
    handleBulkRatesRequest,
    validateDateList,
    mapWithConcurrency,
    MAX_BULK_DATES,
    type BulkHandlerDeps,
} from "./bulk-handler.js";

// ── tiny mock helpers ─────────────────────────────────────────────────────────

function bulkDeps(over: Partial<BulkHandlerDeps> = {}): BulkHandlerDeps {
    return {
        now: () => new Date("2026-06-11T12:00:00Z"),
        checkOrigin: () => ({ allowed: true }),
        rateLimiterTake: () => true,
        getCached: async () => new Map(), // all miss
        runBulkBudget: async (_now, want) => want, // full grant
        fetchOER: async (d) => ({ USD: 1, EUR: 0.9, _d: d as unknown as number }), // tag date for assertions
        saveBatch: async () => {},
        ...over,
    };
}

const req = (body: unknown) => ({
    method: "POST",
    headers: { origin: "https://abcbudget.web.app" } as Record<string, string | undefined>,
    ip: "1.2.3.4",
    body,
});

function makeRes() {
    const res = {
        _status: 0,
        _json: null as unknown,
        status(code: number) {
            this._status = code;
            return this;
        },
        json(data: unknown) {
            this._json = data;
            return this;
        },
    };
    return res;
}

// ── ONE-of-each I/O: getAll / cap-txn / WriteBatch + merged hits+fetched ───────
describe("bulk handler: ONE getCached + ONE budget + ONE saveBatch", () => {
    it("ONE getCached (getAll) split + ONE budget + ONE saveBatch; merged hits+fetched", async () => {
        const getCached = vi.fn(async () => new Map([["2024-01-01", { USD: 1, EUR: 0.8 }]])); // 1 hit
        const runBulkBudget = vi.fn(async (_n: Date, want: number) => want);
        const saveBatch = vi.fn(async () => {});
        const res = makeRes();
        await handleBulkRatesRequest(
            req({ dates: ["2024-01-01", "2024-01-02"] }) as never,
            res as never,
            bulkDeps({ getCached, runBulkBudget, saveBatch })
        );
        expect(getCached).toHaveBeenCalledTimes(1);
        expect(runBulkBudget).toHaveBeenCalledTimes(1);
        expect(runBulkBudget.mock.calls[0][1]).toBe(1); // want = miss count (1 of 2 cached)
        expect(saveBatch).toHaveBeenCalledTimes(1);
        expect(res._status).toBe(200);
        expect(
            Object.keys((res._json as { rates: Record<string, unknown> }).rates).sort()
        ).toEqual(["2024-01-01", "2024-01-02"]);
    });
});

// ── Over-cap: fetch only `allowed` of the misses, omit the rest (no throw) ─────
describe("bulk handler: over-cap omits the cap-cut subset", () => {
    it("over-cap: budget grants fewer than the misses → fetched subset, the rest OMITTED, no throw", async () => {
        const res = makeRes();
        await handleBulkRatesRequest(
            req({ dates: ["2024-01-01", "2024-01-02", "2024-01-03"] }) as never,
            res as never,
            bulkDeps({ runBulkBudget: async () => 2 }) // allow only 2 of 3 misses
        );
        expect(res._status).toBe(200);
        expect(Object.keys((res._json as { rates: Record<string, unknown> }).rates)).toHaveLength(2); // 1 omitted
    });
});

// ── Best-effort: a per-date OER failure is OMITTED, not a 500 ──────────────────
describe("bulk handler: per-date OER failure is best-effort omitted", () => {
    it("a per-date OER failure is OMITTED (best-effort), not a 500", async () => {
        const res = makeRes();
        await handleBulkRatesRequest(
            req({ dates: ["2024-01-01", "2024-01-02"] }) as never,
            res as never,
            bulkDeps({
                fetchOER: async (d) => {
                    if (d === "2024-01-02") throw new Error("OER down");
                    return { USD: 1 };
                },
            })
        );
        expect(res._status).toBe(200);
        expect(Object.keys((res._json as { rates: Record<string, unknown> }).rates)).toEqual([
            "2024-01-01",
        ]);
    });
});

// ── Validation: reject-any-invalid + non-empty + MAX_BULK_DATES (all 400) ──────
describe("bulk handler: validation guards (400)", () => {
    it("reject-any-invalid (400) + non-empty (400) + MAX_BULK_DATES (400)", async () => {
        const bodies = [
            { dates: ["bad"] },
            { dates: [] },
            { dates: Array.from({ length: 367 }, () => "2024-01-01") },
            {},
        ];
        for (const body of bodies) {
            const res = makeRes();
            await handleBulkRatesRequest(req(body) as never, res as never, bulkDeps());
            expect(res._status).toBe(400);
        }
    });
});

// ── Guard order: origin reject (403) before any I/O ───────────────────────────
describe("bulk handler: origin guard (403) before any I/O", () => {
    it("guard order: origin reject (403) before any I/O", async () => {
        const getCached = vi.fn();
        const res = makeRes();
        await handleBulkRatesRequest(
            req({ dates: ["2024-01-01"] }) as never,
            res as never,
            bulkDeps({ checkOrigin: () => ({ allowed: false, reason: "origin-forbidden" }), getCached })
        );
        expect(res._status).toBe(403);
        expect(getCached).not.toHaveBeenCalled();
    });

    it("method guard (405) for GET — no origin/I/O", async () => {
        const getCached = vi.fn();
        const res = makeRes();
        await handleBulkRatesRequest(
            { ...req({ dates: ["2024-01-01"] }), method: "GET" } as never,
            res as never,
            bulkDeps({ getCached })
        );
        expect(res._status).toBe(405);
        expect(getCached).not.toHaveBeenCalled();
    });

    it("rate-limit guard (429) before validate/I/O", async () => {
        const getCached = vi.fn();
        const res = makeRes();
        await handleBulkRatesRequest(
            req({ dates: ["bad"] }) as never, // invalid, but rate-limit fires first
            res as never,
            bulkDeps({ rateLimiterTake: () => false, getCached })
        );
        expect(res._status).toBe(429);
        expect(getCached).not.toHaveBeenCalled();
    });
});

// ── Privacy: the request dates list must never appear in logger calls ──────────
describe("bulk handler: privacy — no per-request-date logging", () => {
    it("does NOT log the dates list (privacy)", async () => {
        const infoSpy = vi.mocked(logger.info);
        const warnSpy = vi.mocked(logger.warn);
        infoSpy.mockClear();
        warnSpy.mockClear();
        const res = makeRes();
        await handleBulkRatesRequest(
            req({ dates: ["2024-01-01", "2024-01-02"] }) as never,
            res as never,
            bulkDeps()
        );
        const allCalls = [...infoSpy.mock.calls, ...warnSpy.mock.calls];
        expect(infoSpy).toHaveBeenCalled(); // it DID emit a summary line
        for (const call of allCalls) {
            expect(JSON.stringify(call)).not.toContain("2024-01-01");
            expect(JSON.stringify(call)).not.toContain("2024-01-02");
        }
    });
});

// ── mapWithConcurrency: bounded pool + order preservation ──────────────────────
describe("mapWithConcurrency", () => {
    it("never exceeds the concurrency limit and preserves order", async () => {
        const limit = 5;
        let inFlight = 0;
        let maxInFlight = 0;
        const items = Array.from({ length: 23 }, (_, i) => i);
        const results = await mapWithConcurrency(items, limit, async (i) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 1));
            inFlight--;
            return i * 2;
        });
        expect(maxInFlight).toBeLessThanOrEqual(limit);
        expect(results).toEqual(items.map((i) => i * 2)); // order preserved
    });

    it("returns [] for an empty list and runs zero workers", async () => {
        const fn = vi.fn(async (x: number) => x);
        const results = await mapWithConcurrency([], 5, fn);
        expect(results).toEqual([]);
        expect(fn).not.toHaveBeenCalled();
    });
});

// ── validateDateList: each-valid + non-empty + ≤MAX ────────────────────────────
describe("validateDateList", () => {
    const now = new Date("2026-06-11T12:00:00Z");

    it("accepts a non-empty list of valid, in-range dates", () => {
        expect(validateDateList(["2024-01-01", "2024-06-01"], now)).toBe(true);
    });

    it("rejects when ANY date is invalid", () => {
        expect(validateDateList(["2024-01-01", "NOT-A-DATE"], now)).toBe(false);
    });

    it("rejects an out-of-range (future) date", () => {
        expect(validateDateList(["2099-01-01"], now)).toBe(false);
    });

    it("rejects an empty list", () => {
        expect(validateDateList([], now)).toBe(false);
    });

    it("rejects a non-array", () => {
        expect(validateDateList("2024-01-01", now)).toBe(false);
        expect(validateDateList(undefined, now)).toBe(false);
    });

    it("rejects more than MAX_BULK_DATES", () => {
        const tooMany = Array.from({ length: MAX_BULK_DATES + 1 }, () => "2024-01-01");
        expect(validateDateList(tooMany, now)).toBe(false);
    });

    it("accepts exactly MAX_BULK_DATES", () => {
        const exactly = Array.from({ length: MAX_BULK_DATES }, () => "2024-01-01");
        expect(validateDateList(exactly, now)).toBe(true);
    });
});
