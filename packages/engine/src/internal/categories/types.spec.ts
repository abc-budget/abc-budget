/**
 * Type-level sanity for the ported `Category` interface (Story 4.2 Task 1).
 *
 * The Category TYPE has no behaviour to exercise — these tests assert the
 * shape compiles and that the required fields (`name`, `isArchived`) are
 * carried verbatim from the prior art.
 */
import { describe, it, expect } from 'vitest';
import type { Category } from './types';

describe('Category type', () => {
  it('constructs a valid Category literal with the required fields', () => {
    const category: Category = {
      name: 'Groceries',
      isArchived: false,
      currency: 'UAH',
    };

    expect(category.name).toBe('Groceries');
    expect(category.isArchived).toBe(false);
    expect(category.currency).toBe('UAH');
  });

  it('accepts the optional fields (id, description, image, imageMetadata)', () => {
    const category: Category = {
      id: 7,
      name: 'Transport',
      description: 'Buses, taxis, fuel',
      image: 'https://example.invalid/transport.png',
      imageMetadata: { width: 64, height: 64 },
      isArchived: true,
      currency: 'EUR',
    };

    expect(category.id).toBe(7);
    expect(category.isArchived).toBe(true);
  });
});
