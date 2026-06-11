import { describe, it, expect } from "vitest";
import { checkOrigin, PROD_ORIGIN_ALLOWLIST } from "./origin.js";

describe("PROD_ORIGIN_ALLOWLIST", () => {
    it("contains the two production origins", () => {
        expect(PROD_ORIGIN_ALLOWLIST).toContain("https://abc-budget-2d379.web.app");
        expect(PROD_ORIGIN_ALLOWLIST).toContain("https://abc-budget-2d379.firebaseapp.com");
        expect(PROD_ORIGIN_ALLOWLIST).toHaveLength(2);
    });
});

describe("checkOrigin", () => {
    const allowlist = PROD_ORIGIN_ALLOWLIST;

    // ── allowed cases ──────────────────────────────────────────────────────────
    it("allows https://abc-budget-2d379.web.app with no Sec-Fetch-Site", () => {
        const result = checkOrigin("https://abc-budget-2d379.web.app", undefined, allowlist);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it("allows https://abc-budget-2d379.firebaseapp.com with no Sec-Fetch-Site", () => {
        const result = checkOrigin("https://abc-budget-2d379.firebaseapp.com", undefined, allowlist);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it("allows valid origin with Sec-Fetch-Site: same-origin", () => {
        const result = checkOrigin(
            "https://abc-budget-2d379.web.app",
            "same-origin",
            allowlist
        );
        expect(result.allowed).toBe(true);
    });

    it("allows valid origin with Sec-Fetch-Site: same-site", () => {
        const result = checkOrigin(
            "https://abc-budget-2d379.web.app",
            "same-site",
            allowlist
        );
        expect(result.allowed).toBe(true);
    });

    // ── missing Origin ─────────────────────────────────────────────────────────
    it("rejects missing Origin (undefined)", () => {
        const result = checkOrigin(undefined, undefined, allowlist);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("origin-missing");
    });

    it("rejects empty Origin string", () => {
        const result = checkOrigin("", undefined, allowlist);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("origin-missing");
    });

    // ── foreign / unlisted Origin ──────────────────────────────────────────────
    it("rejects a foreign origin", () => {
        const result = checkOrigin("https://evil.example.com", undefined, allowlist);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("origin-forbidden");
    });

    it("rejects localhost origin (no localhost in prod)", () => {
        const result = checkOrigin("http://localhost:5173", undefined, allowlist);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("origin-forbidden");
    });

    it("rejects http://localhost:4173", () => {
        const result = checkOrigin("http://localhost:4173", undefined, allowlist);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("origin-forbidden");
    });

    // ── Sec-Fetch-Site cross-site overrides valid Origin ───────────────────────
    it("rejects cross-site Sec-Fetch-Site even with valid Origin", () => {
        const result = checkOrigin(
            "https://abc-budget-2d379.web.app",
            "cross-site",
            allowlist
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("sec-fetch-site-cross");
    });

    it("rejects 'none' Sec-Fetch-Site (no origin) even with valid Origin", () => {
        const result = checkOrigin(
            "https://abc-budget-2d379.web.app",
            "none",
            allowlist
        );
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("sec-fetch-site-cross");
    });

    // ── absent Sec-Fetch-Site is tolerated (older agents) ─────────────────────
    it("tolerates absent Sec-Fetch-Site header for a valid Origin", () => {
        const result = checkOrigin(
            "https://abc-budget-2d379.firebaseapp.com",
            undefined,
            allowlist
        );
        expect(result.allowed).toBe(true);
    });

    // ── custom allowlist ───────────────────────────────────────────────────────
    it("works with a custom allowlist", () => {
        const custom = ["https://custom.example.com"];
        expect(checkOrigin("https://custom.example.com", undefined, custom).allowed).toBe(true);
        expect(checkOrigin("https://abc-budget-2d379.web.app", undefined, custom).allowed).toBe(false);
    });

    // ── exact-match hardening: browser-canonical origins only ──────────────────
    it("rejects near-miss origin variants (trailing slash, case, port, null)", () => {
        for (const variant of [
            "https://abc-budget-2d379.web.app/",
            "https://ABC-BUDGET-2D379.WEB.APP",
            "https://abc-budget-2d379.web.app:443",
            "null",
        ]) {
            expect(checkOrigin(variant, undefined, PROD_ORIGIN_ALLOWLIST).allowed, variant).toBe(false);
        }
    });
});
