/**
 * Returns a month key string in the format "yyyy-MM" for the given date.
 */
export function monthKey(now: Date): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}

/**
 * Pure budget-cap logic (no I/O).
 *
 * Given the current Firestore doc data (a map of {monthKey: count}), a month key,
 * and a cap, returns whether the OER fetch is allowed plus the next doc state.
 *
 * - If the current count for the month is >= cap: allowed = false, next unchanged.
 * - Otherwise: allowed = true, next has the month count incremented by 1.
 * - Other month keys in docData are preserved as-is (month-rollover safety).
 */
export function checkAndIncrementMonthlyCap(
    docData: Record<string, number>,
    key: string,
    cap: number
): { allowed: boolean; next: Record<string, number> } {
    const current = docData[key] ?? 0;
    if (current >= cap) {
        return { allowed: false, next: { ...docData } };
    }
    return {
        allowed: true,
        next: { ...docData, [key]: current + 1 },
    };
}
