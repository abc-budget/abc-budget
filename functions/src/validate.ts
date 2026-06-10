/**
 * Validates whether the input is a date string in the format YYYY-MM-DD.
 *
 * @param {any | null | undefined} date - The input to be validated.
 * @return {boolean} - Returns true if the input is a string formatted as YYYY-MM-DD, otherwise false.
 */
export function validateDate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    date: any | null | undefined
): date is string {
    if (typeof date !== "string") {
        return false;
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    return dateRegex.test(date);
}

/**
 * Checks whether a valid YYYY-MM-DD date string falls within the allowed range.
 * Rejects dates strictly greater than today (future) or strictly less than min (default 1999-01-01).
 * Uses plain string comparison, which is correct for zero-padded ISO date strings.
 *
 * @param date    - A string already validated by validateDate.
 * @param today   - The reference date for the upper bound (inclusive).
 * @param min     - The inclusive lower bound (default: '1999-01-01').
 */
export function isDateInRange(
    date: string,
    today: Date,
    min = "1999-01-01"
): boolean {
    const todayStr = today.toISOString().slice(0, 10);
    return date >= min && date <= todayStr;
}
