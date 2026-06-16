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
      icon: 'glyph-cart',
      isArchived: false,
      currency: 'UAH',
    };

    expect(category.name).toBe('Groceries');
    expect(category.isArchived).toBe(false);
    expect(category.currency).toBe('UAH');
  });

  it('accepts the optional fields (id, description)', () => {
    const category: Category = {
      id: 'b3f1c2a4-5e6d-7f80-9a1b-2c3d4e5f6071',
      name: 'Transport',
      description: 'Buses, taxis, fuel',
      icon: 'glyph-bus',
      isArchived: true,
      currency: 'EUR',
    };

    expect(category.id).toBe('b3f1c2a4-5e6d-7f80-9a1b-2c3d4e5f6071');
    expect(category.isArchived).toBe(true);
  });
});
