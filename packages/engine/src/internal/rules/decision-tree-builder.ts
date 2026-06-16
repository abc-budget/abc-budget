/**
 * Builders for decision-tree components (Story 4.2, Task 2 — EP-4).
 * @module internal/rules/decision-tree-builder
 * @internal
 *
 * PORT of `ComplexRuleBuilder` + `DecisionTreeBuilder` from the prior-art
 * decision-tree `builder.ts`.
 *
 * ADAPT (the only change vs the prior art): the throw path. Prior art threw
 * `new LocalizableException($t('engine.importStatement.stage3.decision-tree.*'))`
 * from `@abc-budget/utils`. Here it is rewired to the ported localization
 * surface: `new LocalizableException(createLocalizableMessage('engine.rules.decision-tree.*'))`.
 */

import type { Category } from '../categories/types';
import {
  createLocalizableMessage,
  LocalizableException,
} from '../utils/messages';
import { ComplexRuleImpl, DecisionTreeImpl } from './decision-tree-impl';
import type { ComplexRule, DecisionTree } from './decision-tree';
import type { Rule } from './rule';

/**
 * Builder for creating complex rules
 */
export class ComplexRuleBuilder {
  private rules: Rule[] = [];
  private category: Category | null = null;
  private id?: number;

  /**
   * Creates a new ComplexRuleBuilder with the same properties as the input builder
   * @param builder The builder to copy from
   * @returns A new builder instance with copied properties
   */
  static from(builder: ComplexRuleBuilder): ComplexRuleBuilder {
    const newBuilder = new ComplexRuleBuilder();
    newBuilder.rules = [...builder.rules];
    newBuilder.category = builder.category;
    newBuilder.id = builder.id;
    return newBuilder;
  }

  /**
   * Adds a rule to the complex rule
   * @param rule The rule to add
   * @returns The builder instance for chaining
   */
  withRule(rule: Rule): ComplexRuleBuilder {
    this.rules.push(rule);
    return this;
  }

  /**
   * Adds multiple rules to the complex rule
   * @param rules The rules to add
   * @returns The builder instance for chaining
   */
  withRules(rules: Rule[]): ComplexRuleBuilder {
    this.rules.push(...rules);
    return this;
  }

  /**
   * Sets the category for the complex rule
   * @param category The category to set
   * @returns The builder instance for chaining
   */
  withCategory(category: Category): ComplexRuleBuilder {
    this.category = category;
    return this;
  }

  /**
   * Sets the ID for the complex rule
   * @param id The ID to set
   * @returns The builder instance for chaining
   */
  withId(id: number): ComplexRuleBuilder {
    this.id = id;
    return this;
  }

  /**
   * Builds the complex rule
   * @returns The built complex rule
   * @throws LocalizableException if no category is set
   */
  build(): ComplexRule {
    if (!this.category) {
      throw new LocalizableException(
        createLocalizableMessage('engine.rules.decision-tree.category-required')
      );
    }

    return new ComplexRuleImpl(this.rules, this.category, this.id);
  }
}

/**
 * Builder for creating decision trees
 */
export class DecisionTreeBuilder {
  private complexRules: ComplexRule[] = [];
  private name = '';
  private description = '';
  private id?: number;

  /**
   * Sets the name of the decision tree
   * @param name The name to set
   * @returns The builder instance for chaining
   */
  withName(name: string): DecisionTreeBuilder {
    this.name = name;
    return this;
  }

  /**
   * Sets the description of the decision tree
   * @param description The description to set
   * @returns The builder instance for chaining
   */
  withDescription(description: string): DecisionTreeBuilder {
    this.description = description;
    return this;
  }

  /**
   * Sets the ID of the decision tree
   * @param id The ID to set
   * @returns The builder instance for chaining
   */
  withId(id: number): DecisionTreeBuilder {
    this.id = id;
    return this;
  }

  /**
   * Adds a complex rule to the decision tree
   * @param complexRule The complex rule to add
   * @returns The builder instance for chaining
   */
  withComplexRule(complexRule: ComplexRule): DecisionTreeBuilder {
    this.complexRules.push(complexRule);
    return this;
  }

  /**
   * Adds multiple complex rules to the decision tree
   * @param complexRules The complex rules to add
   * @returns The builder instance for chaining
   */
  withComplexRules(complexRules: ComplexRule[]): DecisionTreeBuilder {
    this.complexRules.push(...complexRules);
    return this;
  }

  /**
   * Builds the decision tree
   * @returns The built decision tree
   * @throws LocalizableException if no name is set
   */
  build(): DecisionTree {
    if (!this.name) {
      throw new LocalizableException(
        createLocalizableMessage('engine.rules.decision-tree.name-required')
      );
    }

    return new DecisionTreeImpl(
      this.complexRules,
      this.name,
      this.description,
      this.id
    );
  }
}
