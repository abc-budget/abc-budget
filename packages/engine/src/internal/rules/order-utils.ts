/**
 * Utility functions for order management in categorization rules.
 * @module internal/rules/order-utils
 * @internal
 *
 * `identifyNewOrder` is ported VERBATIM from prior-art
 * `@abc-budget/webapp` → `importStatement/stage3/categorization/order-utils.ts`
 * (pure: extract subset orders, sort ascending, reassign to the subset by
 * position, preserve non-subset orders).
 *
 * `reorderRuleOrders` is the pure validation + reorder the prior-art rules
 * service performed, WITHOUT the DAO. The persistence wiring (DAO load/save +
 * reload) is Story 4.3 — this layer only validates ids and computes the new
 * order map.
 */

import { LocalizableException, createLocalizableMessage } from '../utils/messages/index';

/**
 * Identifies new order values for items based on a subset reordering.
 *
 * This function takes a map of all items (id → order) and a subset of ids
 * in the desired new order, then reassigns the orders of items in the subset
 * while preserving the orders of items not in the subset.
 *
 * Algorithm:
 * 1. Extract the orders of items that are in the subset
 * 2. Sort these extracted orders in ascending order
 * 3. Assign the sorted orders to items based on their position in subsetToReorder:
 *    - Position 0 gets the smallest order
 *    - Position 1 gets the second smallest order
 *    - etc.
 * 4. Items NOT in the subset keep their original orders
 *
 * @param items Map of `id → order` for all items
 * @param subsetToReorder Array of ids where position in array represents desired new ordering
 * @returns New map of `id → newOrder` for ALL items (not just the subset)
 *
 * @example
 * ```typescript
 * // Case 1: Reorder [1, 3, 2]
 * identifyNewOrder({1:1, 2:2, 3:3, 4:4, 5:5}, [1, 3, 2])
 * // Returns: {1:1, 2:3, 3:2, 4:4, 5:5}
 * // Explanation: Subset orders [1, 3, 2] → sorted [1, 2, 3]
 * //              id=1 (pos 0) gets 1, id=3 (pos 1) gets 2, id=2 (pos 2) gets 3
 *
 * // Case 2: Reorder [5, 4, 3]
 * identifyNewOrder({1:1, 2:2, 3:3, 4:4, 5:5}, [5, 4, 3])
 * // Returns: {1:1, 2:2, 3:5, 4:4, 5:3}
 * // Explanation: Subset orders [5, 4, 3] → sorted [3, 4, 5]
 * //              id=5 (pos 0) gets 3, id=4 (pos 1) gets 4, id=3 (pos 2) gets 5
 *
 * // Case 3: Reorder [2, 1, 5]
 * identifyNewOrder({1:1, 2:2, 3:3, 4:4, 5:5}, [2, 1, 5])
 * // Returns: {1:2, 2:1, 3:3, 4:4, 5:5}
 * // Explanation: Subset orders [2, 1, 5] → sorted [1, 2, 5]
 * //              id=2 (pos 0) gets 1, id=1 (pos 1) gets 2, id=5 (pos 2) gets 5
 * ```
 */
export function identifyNewOrder(
  items: Record<number, number>,
  subsetToReorder: number[]
): Record<number, number> {
  // Create a copy of the original items map
  const result: Record<number, number> = { ...items };

  // If subset is empty, return original orders
  if (subsetToReorder.length === 0) {
    return result;
  }

  // Extract orders of items in the subset (only valid ids)
  const validIds: number[] = [];
  const subsetOrders: number[] = [];
  for (const id of subsetToReorder) {
    if (id in items) {
      validIds.push(id);
      subsetOrders.push(items[id]);
    }
  }

  // If no valid orders found, return original
  if (subsetOrders.length === 0) {
    return result;
  }

  // Sort the extracted orders in ascending order
  const sortedOrders = [...subsetOrders].sort((a, b) => a - b);

  // Assign sorted orders to valid items based on their position in the validIds array
  for (let i = 0; i < validIds.length; i++) {
    result[validIds[i]] = sortedOrders[i];
  }

  return result;
}

/**
 * Validates a requested rule reorder and computes the new order map — pure.
 *
 * Mirrors the validation the prior-art rules service performed before it
 * persisted, but WITHOUT any DAO / IndexedDB access:
 * - an empty `subsetIds` is a no-op → `currentOrders` is returned unchanged;
 * - every id in `subsetIds` must exist in `currentOrders`, otherwise a
 *   `LocalizableException` (`engine.rules.reorder.rule-not-found`) is thrown;
 * - when all ids are present, the new order map is computed via
 *   {@link identifyNewOrder}.
 *
 * The DAO load/save + reload that surrounds this in production is Story 4.3.
 *
 * @param currentOrders Map of `ruleId → order` for the rules in scope
 * @param subsetIds Rule ids in their desired new order
 * @returns The new `ruleId → order` map for ALL rules in `currentOrders`
 * @throws LocalizableException when a `subsetIds` id is absent from `currentOrders`
 */
export function reorderRuleOrders(
  currentOrders: Record<number, number>,
  subsetIds: number[]
): Record<number, number> {
  // Empty subset is a no-op: nothing to reorder.
  if (subsetIds.length === 0) {
    return currentOrders;
  }

  // Every requested id must be a known rule.
  for (const id of subsetIds) {
    if (!(id in currentOrders)) {
      throw new LocalizableException(
        createLocalizableMessage('engine.rules.reorder.rule-not-found')
      );
    }
  }

  return identifyNewOrder(currentOrders, subsetIds);
}
