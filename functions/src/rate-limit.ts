/**
 * Token-bucket per-IP rate limiter.
 *
 * Designed for in-process use inside a Cloud Functions instance.
 * Provides best-effort rate limiting — since Cloud Functions can run as multiple instances
 * (maxInstances: 2), the effective limit is capacity × maxInstances per IP globally.
 * This is intentional and documented.
 *
 * Clock is injected (now: number — milliseconds since epoch) for pure testability.
 */

interface Bucket {
    tokens: number;
    lastRefillMs: number;
}

const MAX_MAP_SIZE = 10_000;

export class RateLimiter {
    private readonly capacity: number;
    private readonly refillPerMs: number;
    private readonly buckets: Map<string, Bucket> = new Map();

    /**
     * @param capacity    Maximum tokens per key (burst size).
     * @param refillPerMs Token refill rate, in tokens per millisecond.
     *                    e.g. 10 tokens per minute = 10 / 60_000
     */
    constructor(capacity: number, refillPerMs: number) {
        this.capacity = capacity;
        this.refillPerMs = refillPerMs;
    }

    /**
     * Attempts to consume one token for the given key at the given timestamp.
     *
     * @param key The rate-limit key (e.g. client IP address).
     * @param now Current time in milliseconds (injected for testability).
     * @returns true if the request is allowed, false if the bucket is empty (rate-limited).
     */
    take(key: string, now: number): boolean {
        let bucket = this.buckets.get(key);

        if (!bucket) {
            // New key: start with a full bucket
            bucket = { tokens: this.capacity, lastRefillMs: now };
            this._evictIfNeeded();
            this.buckets.set(key, bucket);
        } else {
            // Refill tokens based on elapsed time
            const elapsed = now - bucket.lastRefillMs;
            if (elapsed > 0) {
                const refilled = elapsed * this.refillPerMs;
                bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled);
                bucket.lastRefillMs = now;
            }
        }

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return true;
        }

        return false;
    }

    /**
     * Returns the current number of tracked keys (for testing/monitoring).
     */
    size(): number {
        return this.buckets.size;
    }

    /**
     * Evicts the oldest (first inserted) entry when the Map is at capacity.
     * Simple guard against unbounded memory growth from unique IPs.
     */
    private _evictIfNeeded(): void {
        if (this.buckets.size >= MAX_MAP_SIZE) {
            // Map preserves insertion order; first() is the oldest
            const firstKey = this.buckets.keys().next().value;
            if (firstKey !== undefined) {
                this.buckets.delete(firstKey);
            }
        }
    }
}
