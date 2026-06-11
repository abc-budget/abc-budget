/**
 * Utility functions for sampling data arrays.
 * @module internal/utils/collections/sampling
 *
 * Ported from prior-art `@abc-budget/utils` → `collections/sampling.ts`.
 * Diff-audit (HC-9 founder mandate 2026-06-11):
 *   - Signature preserved verbatim: `sampleArray<T>(array, percentage, maxElements, minElements): T[]`
 *   - Size-clamping math (percentage → ceil → max-cap → min-raise) preserved verbatim.
 *   - Body REPLACED: Fisher-Yates Math.random removed; evenly-spaced deterministic
 *     selection substituted so format detection is reproducible across runs.
 */

/**
 * Takes a deterministic evenly-spaced sample from an array.
 *
 * The size of the sample is computed exactly as in the prior art:
 *   1. `sampleSize = ceil(array.length × percentage / 100)`
 *   2. capped to `maxElements`
 *   3. raised to `minElements` (itself clamped to `array.length`)
 *
 * Elements are selected at evenly-spaced indices (HC-9):
 *   `index[i] = floor(i × array.length / sampleSize)`
 * This makes format detection deterministic and independent of PRNG state.
 *
 * @param array        The array to sample from
 * @param percentage   Percentage of elements to include (0–100)
 * @param maxElements  Upper cap on sample size
 * @param minElements  Lower floor on sample size
 * @returns A deterministic sample of the input array
 */
export function sampleArray<T>(
  array: T[],
  percentage: number,
  maxElements: number,
  minElements: number
): T[] {
  if (!array || array.length === 0) {
    return [];
  }

  // Validate parameters (verbatim from prior art)
  const validPercentage = Math.max(0, Math.min(100, percentage));
  const validMaxElements = Math.max(0, maxElements);
  const validMinElements = Math.max(0, Math.min(array.length, minElements));

  // Calculate sample size based on percentage (verbatim from prior art)
  let sampleSize = Math.ceil((array.length * validPercentage) / 100);

  // Apply max and min constraints (verbatim from prior art)
  sampleSize = Math.min(sampleSize, validMaxElements);
  sampleSize = Math.max(sampleSize, validMinElements);

  // If sample size is greater than or equal to array length, return the entire array
  if (sampleSize >= array.length) {
    return [...array];
  }

  // Deterministic evenly-spaced sampling (HC-9). Prior art used Math.random Fisher-Yates —
  // replaced 2026-06-11 (founder mandate): format detection must not vary run-to-run.
  const result: T[] = [];
  for (let i = 0; i < sampleSize; i++) {
    result.push(array[Math.floor((i * array.length) / sampleSize)]);
  }
  return result;
}
