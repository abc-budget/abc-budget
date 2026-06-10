/**
 * Key types for DAO interfaces
 * @module store/key
 * @internal
 */

/**
 * Represents a simple key type that can be used as an identifier
 * Simple keys are typically primitive types like string, number, etc.
 */
export type SimpleKey = string | number | Date;

/**
 * Represents a compound key type that consists of multiple fields
 * Compound keys are objects where each property is part of the key
 */
export interface CompoundKey {
  [key: string]: SimpleKey;
}

/**
 * Union type representing either a simple key or a compound key
 */
export type Key = SimpleKey | CompoundKey;

/**
 * Type guard to check if a key is a compound key
 * @param key - The key to check
 * @returns True if the key is a compound key, false otherwise
 */
export function isCompoundKey(key: Key): key is CompoundKey {
  return typeof key === 'object' && key !== null && !(key instanceof Date);
}

/**
 * Type guard to check if a key is a simple key
 * @param key - The key to check
 * @returns True if the key is a simple key, false otherwise
 */
export function isSimpleKey(key: Key): key is SimpleKey {
  return !isCompoundKey(key);
}
