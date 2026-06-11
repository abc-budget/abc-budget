/**
 * Utility functions for generating unique IDs.
 * @module internal/utils/id/generator
 *
 * PORT of `webapp/libs/utils/src/lib/id/generator.ts` verbatim.
 * Diff-audit: zero changes — pure port, no adaptation required.
 */

/**
 * Generates a unique ID string
 *
 * The generated ID is a combination of:
 * - A prefix (if provided)
 * - A timestamp component (to ensure uniqueness across time)
 * - A random component (to ensure uniqueness for IDs generated at the same time)
 *
 * @param prefix - Optional prefix to add to the ID
 * @returns A unique string ID
 */
export function generateUniqueId(prefix?: string): string {
  // Get current timestamp in milliseconds
  const timestamp = Date.now().toString(36);

  // Generate a random component (6 random hex characters)
  const randomPart = Math.floor(Math.random() * 0xffffff).toString(36);

  // Combine components with the prefix if provided
  return prefix
    ? `${prefix}_${timestamp}${randomPart}`
    : `${timestamp}${randomPart}`;
}
