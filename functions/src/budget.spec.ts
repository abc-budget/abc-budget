import { describe, it, expect } from "vitest";
import { monthKey, checkAndIncrementMonthlyCap } from "./budget.js";

describe("monthKey", () => {
    it("formats a date in yyyy-MM", () => {
        expect(monthKey(new Date("2026-06-10T00:00:00Z"))).toBe("2026-06");
    });

    it("zero-pads single-digit months", () => {
        expect(monthKey(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03");
    });

    it("handles January correctly", () => {
        expect(monthKey(new Date("2026-01-15T00:00:00Z"))).toBe("2026-01");
    });

    it("handles December correctly", () => {
        expect(monthKey(new Date("2025-12-31T23:59:59Z"))).toBe("2025-12");
    });
});

describe("checkAndIncrementMonthlyCap", () => {
    const CAP = 1000;
    const KEY = "2026-06";

    it("allows first call of the month and sets count to 1", () => {
        const result = checkAndIncrementMonthlyCap({}, KEY, CAP);
        expect(result.allowed).toBe(true);
        expect(result.next[KEY]).toBe(1);
    });

    it("allows call when count is at cap - 1 (999) and increments to cap", () => {
        const result = checkAndIncrementMonthlyCap({ [KEY]: CAP - 1 }, KEY, CAP);
        expect(result.allowed).toBe(true);
        expect(result.next[KEY]).toBe(CAP);
    });

    it("denies call when count is exactly at cap and leaves count unchanged", () => {
        const result = checkAndIncrementMonthlyCap({ [KEY]: CAP }, KEY, CAP);
        expect(result.allowed).toBe(false);
        expect(result.next[KEY]).toBe(CAP);
    });

    it("denies call when count exceeds cap and leaves count unchanged", () => {
        const result = checkAndIncrementMonthlyCap({ [KEY]: CAP + 5 }, KEY, CAP);
        expect(result.allowed).toBe(false);
        expect(result.next[KEY]).toBe(CAP + 5);
    });

    it("treats missing month as 0 (first call)", () => {
        const result = checkAndIncrementMonthlyCap({ "2026-05": 500 }, KEY, CAP);
        expect(result.allowed).toBe(true);
        expect(result.next[KEY]).toBe(1);
    });

    it("month rollover: new month starts at 0 regardless of prior month count", () => {
        const prevKey = "2026-05";
        const docData = { [prevKey]: CAP }; // prior month is exhausted
        const result = checkAndIncrementMonthlyCap(docData, KEY, CAP);
        expect(result.allowed).toBe(true);
        expect(result.next[KEY]).toBe(1);
    });

    it("preserves existing other-month keys in next", () => {
        const otherKey = "2026-05";
        const result = checkAndIncrementMonthlyCap({ [otherKey]: 42 }, KEY, CAP);
        expect(result.allowed).toBe(true);
        expect(result.next[otherKey]).toBe(42);
    });

    it("does not mutate the input docData object", () => {
        const docData = { [KEY]: 5 };
        checkAndIncrementMonthlyCap(docData, KEY, CAP);
        expect(docData[KEY]).toBe(5);
    });

    it("increments from a non-zero starting count", () => {
        const result = checkAndIncrementMonthlyCap({ [KEY]: 100 }, KEY, CAP);
        expect(result.allowed).toBe(true);
        expect(result.next[KEY]).toBe(101);
    });
});
