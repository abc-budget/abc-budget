import { describe, it, expect } from "vitest";
import { validateDate, isDateInRange } from "./validate.js";

describe("validateDate", () => {
    it("accepts a valid YYYY-MM-DD string", () => {
        expect(validateDate("2024-06-15")).toBe(true);
    });

    it("rejects a non-string (number)", () => {
        expect(validateDate(20240615)).toBe(false);
    });

    it("rejects null", () => {
        expect(validateDate(null)).toBe(false);
    });

    it("rejects undefined", () => {
        expect(validateDate(undefined)).toBe(false);
    });

    it("rejects an object", () => {
        expect(validateDate({})).toBe(false);
    });

    it("rejects a date with wrong separator (slash)", () => {
        expect(validateDate("2024/06/15")).toBe(false);
    });

    it("rejects a date missing leading zeros (MM)", () => {
        expect(validateDate("2024-6-15")).toBe(false);
    });

    it("rejects a date missing leading zeros (DD)", () => {
        expect(validateDate("2024-06-5")).toBe(false);
    });

    it("rejects a date-time string", () => {
        expect(validateDate("2024-06-15T00:00:00Z")).toBe(false);
    });

    it("rejects an empty string", () => {
        expect(validateDate("")).toBe(false);
    });

    it("rejects a partial date", () => {
        expect(validateDate("2024-06")).toBe(false);
    });

    it("accepts boundary: 1999-01-01", () => {
        expect(validateDate("1999-01-01")).toBe(true);
    });
});

describe("isDateInRange", () => {
    const today = new Date("2026-06-10T12:00:00Z");

    it("accepts the minimum boundary date", () => {
        expect(isDateInRange("1999-01-01", today)).toBe(true);
    });

    it("rejects a date before the minimum (1998-12-31)", () => {
        expect(isDateInRange("1998-12-31", today)).toBe(false);
    });

    it("rejects a date well before minimum (1900-01-01)", () => {
        expect(isDateInRange("1900-01-01", today)).toBe(false);
    });

    it("accepts today's date", () => {
        expect(isDateInRange("2026-06-10", today)).toBe(true);
    });

    it("rejects tomorrow (future date)", () => {
        expect(isDateInRange("2026-06-11", today)).toBe(false);
    });

    it("rejects a far future date", () => {
        expect(isDateInRange("2099-12-31", today)).toBe(false);
    });

    it("accepts a date well within range", () => {
        expect(isDateInRange("2023-03-15", today)).toBe(true);
    });

    it("respects a custom min boundary", () => {
        expect(isDateInRange("2020-01-01", today, "2020-01-01")).toBe(true);
        expect(isDateInRange("2019-12-31", today, "2020-01-01")).toBe(false);
    });
});
