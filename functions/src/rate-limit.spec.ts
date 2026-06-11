import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
    // capacity=5, refill 5 tokens per 60_000ms (1 per 12s)
    const CAPACITY = 5;
    const REFILL_PER_MS = CAPACITY / 60_000;

    it("allows the first request", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        expect(rl.take("ip1", 0)).toBe(true);
    });

    it("allows burst up to capacity", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        for (let i = 0; i < CAPACITY; i++) {
            expect(rl.take("ip1", 0)).toBe(true);
        }
    });

    it("denies the (capacity+1)th request in a burst", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        for (let i = 0; i < CAPACITY; i++) {
            rl.take("ip1", 0);
        }
        expect(rl.take("ip1", 0)).toBe(false);
    });

    it("refills tokens over time", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        // Drain completely
        for (let i = 0; i < CAPACITY; i++) {
            rl.take("ip1", 0);
        }
        // Advance time enough to refill 1 token (12_000ms = 1 token)
        const oneTokenMs = Math.ceil(1 / REFILL_PER_MS);
        expect(rl.take("ip1", oneTokenMs)).toBe(true);
    });

    it("refill does not exceed capacity", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        // Advance huge amount of time — bucket should stay capped at capacity
        const hugeFutureMs = 1_000_000_000;
        for (let i = 0; i < CAPACITY; i++) {
            expect(rl.take("ip1", hugeFutureMs)).toBe(true);
        }
        expect(rl.take("ip1", hugeFutureMs)).toBe(false);
    });

    it("per-key isolation — draining one key does not affect another", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        for (let i = 0; i < CAPACITY; i++) {
            rl.take("ip1", 0);
        }
        // ip2 should still have a full bucket
        expect(rl.take("ip2", 0)).toBe(true);
    });

    it("different keys track independently", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        // ip1 takes 3
        for (let i = 0; i < 3; i++) rl.take("ip1", 0);
        // ip2 takes 3
        for (let i = 0; i < 3; i++) rl.take("ip2", 0);
        // ip1 still has 2 left
        expect(rl.take("ip1", 0)).toBe(true);
        expect(rl.take("ip1", 0)).toBe(true);
        expect(rl.take("ip1", 0)).toBe(false);
        // ip2 still has 2 left
        expect(rl.take("ip2", 0)).toBe(true);
        expect(rl.take("ip2", 0)).toBe(true);
        expect(rl.take("ip2", 0)).toBe(false);
    });

    it("eviction guard: keeps Map size bounded when many unique keys arrive", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        const LIMIT = 10_001;
        for (let i = 0; i < LIMIT; i++) {
            rl.take(`ip${i}`, i);
        }
        // The Map should not have grown unboundedly (eviction kicks in)
        expect(rl.size()).toBeLessThanOrEqual(10_000);
    });

    it("denies a sustained flood (more than capacity with zero elapsed time)", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        let allowed = 0;
        for (let i = 0; i < CAPACITY * 3; i++) {
            if (rl.take("flood-ip", 0)) allowed++;
        }
        expect(allowed).toBe(CAPACITY);
    });

    it("clock skew: a now earlier than lastRefill never inflates tokens (negative-time guard)", () => {
        const rl = new RateLimiter(CAPACITY, REFILL_PER_MS);
        for (let i = 0; i < CAPACITY; i++) rl.take("skew-ip", 1_000_000);
        // clock jumps BACKWARD — refill must not fire, bucket stays drained
        expect(rl.take("skew-ip", 0)).toBe(false);
        expect(rl.take("skew-ip", 999_999)).toBe(false);
    });
});
