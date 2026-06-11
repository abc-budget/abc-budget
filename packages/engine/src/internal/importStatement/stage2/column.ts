/**
 * ImportStatementColumn — crown-jewel column transforms.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/column.ts` (1,735 lines).
 * Adaptations (diff-audit tracked below and in the commit report):
 *
 * 1. **Import paths**
 *    `@abc-budget/logging`  → `../../logging`
 *    `@abc-budget/utils`    → `../../utils/messages/index` + `../../utils/numbers/parsing`
 *                             + `../../utils/date/format-detector`
 *    `luxon`                → runtime DateTime access via lazy seam
 *                             (`../../utils/date/luxon-lazy`) for call sites in
 *                             async transform paths; type-only imports stay `import type`.
 *    `../../currency`       → `../../currency/reference` (numericCodeToIso, getAmbiguousSymbols,
 *                             symbolToIso) — replaces CurrencyCache (see §2 below).
 *    `../../settings/…`     → `../../settings/engine-config`
 *    `../types`             → relative `../types`  (unchanged shape)
 *    `./types`              → `./types` (unchanged shape)
 *
 * 2. **CurrencyCache → 1.6 wiring**
 *    Prior art: constructor accepted `CurrencyCache | null`; `parseAsCurrency` called
 *    `this._currencyCache.getAll()` → `CurrencyData[]` with `.code`, `.numericCode`,
 *    `.symbols[]`, then did three-level matching: alpha-code, numeric-code, symbol
 *    (with ambiguity detection).
 *
 *    1.6 replacement (preserving exact behavior):
 *    - Alpha-code match    → `symbolToIso(upper)` (code passthrough in reference.ts)
 *    - Numeric-code match  → `numericCodeToIso(numericValue)` (new export in reference.ts)
 *    - Symbol match        → `symbolToIso(trimmed)` for unambiguous;
 *                            `getAmbiguousSymbols()` set to detect ambiguity before lookup.
 *    - `_currencyCache` field removed; constructor param removed.
 *    - `copy()` no longer passes currencyCache.
 *
 *    Base-currency source: `params.currency` carries a `CurrencyDetectOptions` value.
 *    In `parseAsCurrency` the params are null (the CURRENCY column stores no params);
 *    base-currency resolution for AMOUNT is deferred to row-processing time (stage 3+)
 *    and does not happen inside this column transform.
 *    TODO-2.3/2.4: when the settings store is implemented, AMOUNT's `use_base` option
 *    will resolve against the budget's stored base currency via the store-backed
 *    `getEngineConfig()` successor.
 *
 * 3. **getEngineConfig** → `../../settings/engine-config`  (no behavior change)
 *
 * 4. **verbatimModuleSyntax `import type` fixes**
 *    - `import type { DateTime } from 'luxon'` — type-only; runtime access via
 *      `getLuxon()` lazy seam helper.
 *    - All re-exported interface imports already use `import type`.
 *
 * EXTEND (new transforms, following per-type pattern):
 * - `parseAsTime()`         — label-only; no cell output; column marked TIME.
 * - `parseAsCounterparty()` — DESCRIPTION-like text transform; output field counterparty.
 *
 * NOTHING else changes from the verbatim prior art.
 */

import { getLogger } from '../../logging';
import {
  $t,
  LocalizableException,
  LocalizableMessage,
} from '../../utils/messages/index';
import type { Message } from '../../utils/messages/index';
import { isNan, parseNumber } from '../../utils/numbers/parsing';
import {
  detectDateFormat as detectDateFormatBase,
  extractDatePart,
} from '../../utils/date/format-detector';
import { getLuxon } from '../../utils/date/luxon-lazy';
import { getAmbiguousSymbols, numericCodeToIso, symbolToIso } from '../../currency/reference';
import { getEngineConfig } from '../../settings/engine-config';
import {
  ColumnDefinition,
} from '../types';
import type {
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnParams,
  DateColumnParams,
  TransactionStatusColumnParams,
} from '../types';
import {
  SupportedDataType,
} from './types';
import type {
  CellData,
  ImportStatementColumnHeaderStage2,
  ImportStatementStage2,
} from './types';

// Create a logger for this file
const logger = getLogger('engine.importStatement.column');

/**
 * Implementation of ImportStatementColumnHeaderStage2
 */
export class ImportStatementColumn implements ImportStatementColumnHeaderStage2 {
  readonly id: string;
  readonly name: Message;
  readonly originalName: Message;
  readonly definition: ColumnDefinition | null = null;

  get isIgnored(): boolean {
    return this.definition === ColumnDefinition.IGNORE;
  }

  readonly params: ColumnParams | null = null;
  readonly data: CellData[] = [];
  private _stage2: ImportStatementStage2 | null = null;

  constructor(
    id: string,
    name: Message,
    originalName: Message,
    definition: ColumnDefinition | null = null,
    params: ColumnParams | null = null,
    data: CellData[] = []
  ) {
    this.id = id;
    this.name = name;
    this.originalName = originalName;
    this.definition = definition;
    this.params = params;
    this.data = data;
  }

  /**
   * Associates this column with a stage2 instance.
   * Can only be called once - if the column is already associated with a different stage2 instance, throws an error.
   * @param stage2 The stage2 instance to associate with
   * @throws Error if the column is already associated with a different stage2 instance
   */
  associateWith(stage2: ImportStatementStage2): void {
    if (this._stage2 !== null && this._stage2 !== stage2) {
      throw new Error(
        `Column ${this.id} is already associated with a stage2 instance`
      );
    }
    this._stage2 = stage2;
  }

  /**
   * Validates that this column is associated with a stage2 instance.
   * @throws Error if the column is not associated with a stage2 instance
   * @private
   */
  private validate(): void {
    if (this._stage2 === null) {
      throw new Error(
        `Column ${this.id} is not associated with a stage2 instance`
      );
    }
  }

  /**
   * Validates that the column can be transformed to the specified definition.
   * @param targetDefinition The target column definition
   * @param errorMessageKey The localization key for error messages
   * @throws LocalizableException if the column is already transformed to another definition
   * @private
   */
  private validateTransformation(
    targetDefinition: ColumnDefinition,
    errorMessageKey: string
  ): boolean {
    // If current column already has the target definition - nothing to do
    if (this.definition === targetDefinition) {
      return true;
    }

    // Check current state - parse operation possible to do only when definition is null
    if (this.definition !== null) {
      // Need to "undo" before parsing
      throw new LocalizableException(
        $t(errorMessageKey, {
          message: $t('engine.importStatement.column-already-transformed'),
        })
      );
    }
    return false;
  }

  /**
   * Checks if the error percentage is acceptable.
   * @param errorCount The number of errors encountered during parsing
   * @param totalCount The total number of items to consider for error percentage calculation
   * @param errorMessageKey The localization key for error messages
   * @throws LocalizableException if the error percentage exceeds the acceptable threshold
   * @private
   */
  private validateErrorPercentage(
    errorCount: number,
    totalCount: number,
    errorMessageKey: string
  ): void {
    const errorPercentage = totalCount > 0 ? errorCount / totalCount : 0;
    const acceptableErrorPercentage =
      getEngineConfig().acceptableColumnErrorPercentage;

    if (errorPercentage > acceptableErrorPercentage) {
      throw new LocalizableException(
        $t(errorMessageKey, {
          message: $t('engine.importStatement.too-many-parsing-errors', {
            errorPercentage: (errorPercentage * 100).toFixed(1),
            acceptablePercentage: (acceptableErrorPercentage * 100).toFixed(1),
          }),
        })
      );
    }
  }

  /**
   * Generic method to handle the common pattern of parsing column data.
   * @param options The options for parsing
   * @param options.targetDefinition The target column definition
   * @param options.errorMessageKey The localization key for error messages
   * @param options.params The column parameters
   * @param options.name The localizable message for the column name
   * @param options.parseFunction The function to parse each cell
   * @returns Promise<void>
   * @private
   */
  private async parseGeneric<T extends ColumnParams>(options: {
    targetDefinition: ColumnDefinition;
    errorMessageKey: string;
    params: T | null;
    name: LocalizableMessage;
    parseFunction: (cell: CellData) => CellData;
  }): Promise<void> {
    const { targetDefinition, errorMessageKey, params, name, parseFunction } =
      options;
    logger.groupCollapsed(
      'parseGeneric: targetDefinition=',
      targetDefinition,
      ', column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug(
      'Parameters: errorMessageKey=',
      errorMessageKey,
      ', params=',
      params
    );

    // Validate that column is associated with stage2
    this.validate();
    const stage2 = this._stage2;
    if (!stage2) {
      throw new Error(
        `Column ${this.id} is not associated with a stage2 instance`
      );
    }

    // If current column already has the target definition - nothing to do
    if (this.definition === targetDefinition) {
      logger.debug('Column already has target definition, returning early');
      logger.groupEnd();
      return;
    }

    // Iterate over all data and try to parse cell values
    const newData: CellData[] = [];
    let errorCount = 0;

    logger.debug('Starting to process', this.data.length, 'cells');

    for (const cell of this.data) {
      try {
        logger.groupCollapsed('Processing cell:', cell);
        const result = parseFunction(cell);
        newData.push(result);
        logger.debug('Parsing result:', result);
        logger.groupEnd();

        if (result.error) {
          errorCount++;
        }
      } catch (error) {
        // Exception during parsing - use old value and set error
        logger.groupEnd(); // Ensure group is closed in case of exception
        logger.debug('Exception during parsing:', error);
        newData.push({
          value: cell.value,
          error: $t(errorMessageKey, {
            message: $t('engine.importStatement.parsing-error', {
              error: error instanceof Error ? error.message : String(error),
            }),
          }),
          type: cell.type,
        });
        errorCount++;
      }
    }

    logger.debug(
      'Cell processing completed. Results: errorCount=',
      errorCount,
      'total cells=',
      this.data.length
    );

    // Check error percentage
    const totalCount = this.data.length;
    const errorPercentage = totalCount > 0 ? errorCount / totalCount : 0;
    logger.debug(
      'Error percentage calculation: errorCount=',
      errorCount,
      ', totalCount=',
      totalCount,
      ', errorPercentage=',
      errorPercentage
    );

    try {
      this.validateErrorPercentage(errorCount, totalCount, errorMessageKey);
      logger.debug('Error percentage validation passed');
    } catch (error) {
      logger.debug('Error percentage validation failed:', error);
      logger.groupEnd();
      throw error;
    }

    // Create a new copy of column with the new data, target definition, and name
    logger.debug('Creating new column with updated data, definition, and name');
    const newColumn = this.copy({
      name: name,
      definition: targetDefinition,
      params: params,
      data: newData,
    });

    // Apply new column to the stage
    logger.debug('Applying new column to stage');
    stage2.applyColumn(newColumn);

    logger.debug('parseGeneric completed successfully');
    logger.groupEnd();
  }

  /**
   * Creates a copy of this column header with optionally modified properties
   * @param name The display name/message for the column
   * @param definition The column definition specifying its type and behavior
   * @param params Additional parameters specific to the column type
   * @param data The cell data contained in this column
   * @returns A new instance with the specified changes
   */
  copy({
    name,
    definition,
    params,
    data,
  }: {
    name?: Message;
    definition?: ColumnDefinition | null;
    params?: ColumnParams | null;
    data?: CellData[];
  } = {}): ImportStatementColumn {
    const newColumn = new ImportStatementColumn(
      this.id,
      name !== undefined ? name : this.name,
      this.originalName,
      definition !== undefined ? definition : this.definition,
      params !== undefined ? params : this.params,
      data !== undefined ? data : this.data
    );

    // Associate with the same stage2 if this column is associated
    if (this._stage2 !== null) {
      newColumn.associateWith(this._stage2);
    }

    return newColumn;
  }

  async ignore(): Promise<void> {
    logger.groupCollapsed('ignore: column=', this.name, ', id=', this.id);
    logger.debug('Starting ignore operation');

    logger.debug('Validating column');
    this.validate();
    const stage2 = this._stage2;
    if (!stage2) {
      throw new Error(
        `Column ${this.id} is not associated with a stage2 instance`
      );
    }

    const errorMessageKey = "engine.importStatement.can't-ignore";
    logger.debug('Checking if transformation is valid');
    if (this.validateTransformation(ColumnDefinition.IGNORE, errorMessageKey)) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Create copy of that column and apply to the stage
    logger.debug('Creating copy of column with IGNORE definition');
    const ignoredColumn = this.copy({
      definition: ColumnDefinition.IGNORE,
    });

    logger.debug('Applying ignored column to stage');
    stage2.applyColumn(ignoredColumn);

    logger.debug('Ignore operation completed successfully');
    logger.groupEnd();
  }

  async parseAsDate(params: DateColumnParams): Promise<void> {
    logger.groupCollapsed('parseAsDate: column=', this.name, ', id=', this.id);
    logger.debug('Starting date parsing with params:', params);

    const errorMessageKey = "engine.importStatement.can't-parse-as-date";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (this.validateTransformation(ColumnDefinition.DATE, errorMessageKey)) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Detect date format
    let format: string;
    logger.debug('Detecting date format. Format parameter:', params.format);
    if (params.format === 'auto') {
      // Extract string values from data array
      logger.debug('Auto format detection requested, extracting string values');
      const stringValues = this.data.map((cell) => String(cell.value));
      logger.debug(
        'Extracted',
        stringValues.length,
        'string values for format detection'
      );

      // Use detectDateFormat to detect format (ASYNC — lazy luxon seam, Task 1)
      logger.debug('Calling detectDateFormat');
      const detectedFormat = await detectDateFormatBase(
        stringValues,
        10,
        1000,
        100,
        getEngineConfig().acceptableParseDatePercentage
      );
      logger.debug('Detected format:', detectedFormat);

      // If detected format is null - throw localized exception
      if (detectedFormat === null) {
        logger.debug('No format detected, throwing exception');
        logger.groupEnd();
        throw new LocalizableException(
          $t(errorMessageKey, {
            message: $t('engine.importStatement.date-format-not-detected'),
          })
        );
      }

      format = detectedFormat;
      logger.debug('Using detected format:', format);
    } else {
      // Use custom format
      format = params.format.custom;
      logger.debug('Using custom format:', format);
    }

    logger.debug('Loading luxon via lazy seam before date parsing');
    // Adaptation (lazy luxon, plan §Task-1, §Task-3):
    // We load luxon ONCE here (async, before parseGeneric) so that the closure
    // passed to parseGeneric's synchronous parseFunction can use DateTime directly.
    // This avoids any require() inside the closure and keeps the call pattern clean.
    const { DateTime } = await getLuxon();

    logger.debug('Calling parseGeneric with date-specific parsing function');
    // Use the generic parsing method with a date-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.DATE,
      errorMessageKey,
      params,
      name: $t('engine.importStatement.column.date'),
      parseFunction: (cell) => {
        const stringValue = String(cell.value);
        // Extract only the date part from the string
        const dateOnlyString = extractDatePart(stringValue);
        // DateTime is captured from the lazy-loaded luxon module above.
        // Zone + locale pinned for TZ/locale determinism (HC-9).
        const dateValue = DateTime.fromFormat(dateOnlyString, format, {
          zone: 'utc',
          locale: 'en-US',
        });

        if (dateValue.isValid) {
          // Successfully parsed as date
          return {
            value: dateValue.toJSDate(),
            type: SupportedDataType.DATE,
          } satisfies CellData;
        } else {
          // Parse failed - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.date-parse-failed', {
                value: stringValue,
                format: format,
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsDate completed successfully');
    logger.groupEnd();
  }

  async parseAsAmount(params: AmountColumnParams): Promise<void> {
    logger.groupCollapsed(
      'parseAsAmount: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting amount parsing with params:', params);

    const errorMessageKey = "engine.importStatement.can't-parse-as-amount";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (this.validateTransformation(ColumnDefinition.AMOUNT, errorMessageKey)) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Determine amount type - default to 'auto' if not specified
    const amountType = params.type || 'auto';
    logger.debug('Amount type:', amountType);

    // For 'auto' type, we need to analyze the data to determine if it's mixed or outcome
    let effectiveAmountType = amountType;
    if (amountType === 'auto') {
      logger.debug('Auto type detection requested, analyzing data');

      // Sample the data and count positive and negative values
      let positiveCount = 0;
      let negativeCount = 0;

      // Process each cell to count positive and negative values
      for (const cell of this.data) {
        if (cell.value === null) continue;

        let numberValue: number;

        // If the value is already a number, use it as is
        if (typeof cell.value === 'number') {
          numberValue = cell.value;
        } else {
          // Otherwise, parse it as a string
          const stringValue = String(cell.value);
          numberValue = parseNumber(stringValue);
        }

        if (!isNaN(numberValue)) {
          if (numberValue > 0) {
            positiveCount++;
          } else if (numberValue < 0) {
            negativeCount++;
          }
        }
      }

      logger.debug(
        'Data analysis results: positiveCount=',
        positiveCount,
        ', negativeCount=',
        negativeCount
      );

      // Determine the effective type based on the analysis
      if (positiveCount > 0 && negativeCount > 0) {
        // We have both positive and negative values -> mixed type
        effectiveAmountType = 'mixed';
        logger.debug(
          'Auto detection result: mixed type (both positive and negative values found)'
        );
      } else if (positiveCount > 0 || negativeCount > 0) {
        // We have only positive or only negative values -> outcome type
        effectiveAmountType = 'outcome';
        logger.debug(
          'Auto detection result: outcome type (only one sign of values found)'
        );
      } else {
        // No valid numbers found, default to income
        effectiveAmountType = 'income';
        logger.debug(
          'Auto detection result: defaulting to income type (no valid numbers found)'
        );
      }

      logger.debug('Effective amount type:', effectiveAmountType);
    }

    // Determine column name based on effectiveAmountType and currency parameter
    let columnName: LocalizableMessage;
    let columnPrefix: string;

    // Select the appropriate prefix based on effectiveAmountType
    if (effectiveAmountType === 'mixed') {
      columnPrefix = 'engine.importStatement.column.amount';
    } else if (effectiveAmountType === 'income') {
      columnPrefix = 'engine.importStatement.column.income';
    } else if (effectiveAmountType === 'outcome') {
      columnPrefix = 'engine.importStatement.column.outcome';
    } else {
      // Default fallback (should not reach here)
      columnPrefix = 'engine.importStatement.column.amount';
    }

    // Determine the full column name based on the prefix and currency
    if (params.currency === 'auto') {
      columnName = $t(columnPrefix);
    } else if (params.currency === 'use_base') {
      columnName = $t(`${columnPrefix}-in-base-currency`);
    } else {
      columnName = $t(`${columnPrefix}-in-currency`, {
        currency: params.currency.code,
      });
    }

    logger.debug('Calling parseGeneric with amount-specific parsing function');

    // Use the generic parsing method with an amount-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.AMOUNT,
      errorMessageKey,
      params,
      name: columnName,
      parseFunction: (cell) => {
        // Check for null or NaN values first
        if (
          cell.value === null ||
          (typeof cell.value === 'number' && isNaN(cell.value))
        ) {
          // Treat null or NaN as error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.amount-parse-failed', {
                value: String(cell.value),
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }

        let numberValue: number;

        // If the value is already a number, use it as is
        if (typeof cell.value === 'number') {
          numberValue = cell.value;
        } else {
          // Otherwise, parse it as a string
          const stringValue = String(cell.value);
          numberValue = parseNumber(stringValue);
        }

        if (!isNaN(numberValue)) {
          // Successfully parsed as number

          // Apply type-specific transformations
          if (effectiveAmountType === 'income') {
            // Income type — VIS-011 label-and-discard: ALL rows are skipped with a reason
            // (FEAT-022 shape: the `ignore` field names the cause so downstream row
            //  processing can report why this cell was discarded).
            return {
              value: numberValue,
              type: SupportedDataType.NUMBER,
              ignore: $t('engine.importStatement.income-value-ignored', {
                value: numberValue,
              }),
            } satisfies CellData;
          } else if (effectiveAmountType === 'outcome') {
            // Outcome type - take absolute value, ignore zeros
            if (numberValue === 0) {
              return {
                value: 0,
                type: SupportedDataType.NUMBER,
                ignore: $t('engine.importStatement.zero-value-ignored'),
              } satisfies CellData;
            }
            return {
              value: Math.abs(numberValue),
              type: SupportedDataType.NUMBER,
            } satisfies CellData;
          } else if (effectiveAmountType === 'mixed') {
            // Mixed type - ignore positive values, take absolute value of negative, ignore zeros
            if (numberValue > 0) {
              return {
                value: numberValue,
                type: SupportedDataType.NUMBER,
                ignore: $t('engine.importStatement.positive-value-ignored', {
                  value: numberValue,
                }),
              } satisfies CellData;
            } else if (numberValue === 0) {
              return {
                value: 0,
                type: SupportedDataType.NUMBER,
                ignore: $t('engine.importStatement.zero-value-ignored'),
              } satisfies CellData;
            }
            return {
              value: Math.abs(numberValue),
              type: SupportedDataType.NUMBER,
            } satisfies CellData;
          }

          // Default fallback (should not reach here)
          return {
            value: numberValue,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        } else {
          // Parse failed - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.amount-parse-failed', {
                value: String(cell.value),
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsAmount completed successfully');
    logger.groupEnd();
  }

  async parseAsCurrency(): Promise<void> {
    logger.groupCollapsed(
      'parseAsCurrency: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting currency parsing');

    const errorMessageKey = "engine.importStatement.can't-parse-as-currency";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(ColumnDefinition.CURRENCY, errorMessageKey)
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Adaptation (1.6 wiring): Prior art used CurrencyCache.getAll() to get a list
    // of CurrencyData objects, then matched by code, numeric code, and symbol.
    // 1.6 replacement:
    //   - Alpha-code / symbol matching → symbolToIso (handles code passthrough,
    //     en/uk symbols, specialSymbols per reference.ts rules).
    //   - Numeric-code matching        → numericCodeToIso (new export in reference.ts).
    //   - Ambiguity detection          → getAmbiguousSymbols() Set built once here.
    //
    // Behavior preserved: code → upper-case passthrough; numeric → ISO code;
    // unambiguous symbol → ISO code; ambiguous symbol → error; unknown → error;
    // empty/null → error.
    logger.debug('Building ambiguous-symbol set from 1.6 reference module');
    const ambiguousSymbols = getAmbiguousSymbols();

    // Create a map to cache currency lookups
    logger.debug('Creating currency lookup cache');
    const currencyLookupCache = new Map<
      string | number | null | undefined,
      string | null
    >();

    // Use the generic parsing method with a currency-specific parsing function
    logger.debug('Starting generic parsing with currency-specific function');
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.CURRENCY,
      errorMessageKey,
      params: null,
      name: $t('engine.importStatement.column.currency'),
      parseFunction: (cell) => {
        // Treat null or empty values as errors
        if (
          cell.value === null ||
          cell.value === undefined ||
          cell.value === ''
        ) {
          logger.debug('Cell value is null/empty, returning error');
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.currency-parse-failed', {
                value: 'empty',
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }

        // Check if we have this value in the cache
        if (currencyLookupCache.has(cell.value)) {
          const cachedCurrencyCode = currencyLookupCache.get(cell.value);
          logger.debug('Found in cache:', cachedCurrencyCode);

          if (cachedCurrencyCode) {
            // Return cached currency code
            return {
              value: cachedCurrencyCode,
              type: SupportedDataType.CURRENCY,
            } satisfies CellData;
          } else {
            // We cached a failed lookup
            logger.debug('Cached lookup was a failure');
            return {
              value: cell.value,
              error: $t(errorMessageKey, {
                message: $t('engine.importStatement.currency-parse-failed', {
                  value: String(cell.value),
                }),
              }),
              type: cell.type,
            } satisfies CellData;
          }
        }

        const stringValue = String(cell.value);

        // Parse as number for numeric code matching
        let numericValue: number | null = null;
        if (typeof cell.value === 'number') {
          numericValue = cell.value;
        } else {
          try {
            numericValue = parseNumber(stringValue);
          } catch {
            numericValue = null;
          }
        }

        // Normalize string value for code matching and trim whitespace
        const trimmed = stringValue.trim();
        const upper = trimmed.toUpperCase();

        // First try to match by alpha code (case-insensitive)
        // symbolToIso does code passthrough (Rule 1: byCode.has(input))
        const codeMatchResult = symbolToIso(upper);
        if (codeMatchResult !== undefined && byCode_has(upper)) {
          logger.debug('Found match by code:', codeMatchResult);
          const outCode = codeMatchResult.toUpperCase();
          currencyLookupCache.set(cell.value, outCode);
          return {
            value: outCode,
            type: SupportedDataType.CURRENCY,
          } satisfies CellData;
        }

        // Then try to match by numeric code
        if (numericValue !== null && !isNaN(numericValue)) {
          const numericMatch = numericCodeToIso(numericValue);
          if (numericMatch !== undefined) {
            logger.debug('Found match by numeric code:', numericMatch);
            const outCode = numericMatch.toUpperCase();
            currencyLookupCache.set(cell.value, outCode);
            return {
              value: outCode,
              type: SupportedDataType.CURRENCY,
            } satisfies CellData;
          }
        }

        // Finally, try to match by symbol; detect ambiguity
        if (ambiguousSymbols.has(trimmed)) {
          logger.debug('Ambiguous symbol:', trimmed);
          currencyLookupCache.set(cell.value, null);
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.currency-parse-failed', {
                value: `${trimmed} (ambiguous)`,
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }

        const symbolMatch = symbolToIso(trimmed);
        if (symbolMatch !== undefined) {
          logger.debug('Found match by symbol:', symbolMatch);
          const outCode = symbolMatch.toUpperCase();
          currencyLookupCache.set(cell.value, outCode);
          return {
            value: outCode,
            type: SupportedDataType.CURRENCY,
          } satisfies CellData;
        }

        // No match found - use old value and set error
        logger.debug('No currency match found, returning error');

        // Cache the failed lookup
        currencyLookupCache.set(cell.value, null);

        return {
          value: cell.value,
          error: $t(errorMessageKey, {
            message: $t('engine.importStatement.currency-parse-failed', {
              value: trimmed,
            }),
          }),
          type: cell.type,
        } satisfies CellData;
      },
    });

    logger.debug('Finished currency parsing');
    logger.groupEnd();
  }

  async parseAsDescription(): Promise<void> {
    logger.groupCollapsed(
      'parseAsDescription: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting description parsing');

    const errorMessageKey = "engine.importStatement.can't-parse-as-description";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(ColumnDefinition.DESCRIPTION, errorMessageKey)
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    logger.debug(
      'Calling parseGeneric with description-specific parsing function'
    );
    // Use the generic parsing method with a description-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.DESCRIPTION,
      errorMessageKey,
      params: {},
      name: $t('engine.importStatement.column.description'),
      parseFunction: (cell) => {
        // Check for null values first
        if (
          cell.value === null ||
          cell.value === undefined ||
          cell.value === ''
        ) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        } else {
          // Convert to string
          return {
            value: String(cell.value),
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsDescription completed successfully');
    logger.groupEnd();
  }

  async parseAsBankCategory(): Promise<void> {
    logger.groupCollapsed(
      'parseAsBankCategory: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting bank category parsing');

    const errorMessageKey = "engine.importStatement.can't-parse-as-category";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(ColumnDefinition.CATEGORY, errorMessageKey)
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    logger.debug(
      'Calling parseGeneric with category-specific parsing function'
    );
    // Use the generic parsing method with a category-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.CATEGORY,
      errorMessageKey,
      params: {},
      name: $t('engine.importStatement.column.category'),
      parseFunction: (cell) => {
        // Check for null values first
        if (
          cell.value === null ||
          cell.value === undefined ||
          cell.value === ''
        ) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        } else {
          // Convert to string
          return {
            value: String(cell.value),
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsBankCategory completed successfully');
    logger.groupEnd();
  }

  async parseAsBalance(params: BalanceColumnParams): Promise<void> {
    logger.groupCollapsed(
      'parseAsBalance: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting balance parsing with params:', params);

    const errorMessageKey = "engine.importStatement.can't-parse-as-balance";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(ColumnDefinition.BALANCE, errorMessageKey)
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Determine column name based on currency parameter
    let columnName: LocalizableMessage;
    if (params.currency === 'auto') {
      columnName = $t('engine.importStatement.column.balance');
    } else if (params.currency === 'use_base') {
      columnName = $t('engine.importStatement.column.balance-in-base-currency');
    } else {
      columnName = $t('engine.importStatement.column.balance-in-currency', {
        currency: params.currency.code,
      });
    }

    logger.debug('Calling parseGeneric with balance-specific parsing function');
    // Use the generic parsing method with a balance-specific parsing function
    // and specify to count only non-null values for error percentage calculation
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.BALANCE,
      errorMessageKey,
      params,
      name: columnName,
      parseFunction: (cell) => {
        // Check for null or NaN values first
        if (isNan(cell.value)) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        }

        // If the value is already a number, use it as is
        let numberValue: number;
        if (typeof cell.value === 'number') {
          numberValue = cell.value;
        } else {
          // Otherwise, parse it as a string
          const stringValue = String(cell.value);
          numberValue = parseNumber(stringValue);
        }

        if (!isNaN(numberValue)) {
          // Successfully parsed as number
          return {
            value: numberValue,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        } else {
          // Parse failed - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.balance-parse-failed', {
                value: String(cell.value),
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsBalance completed successfully');
    logger.groupEnd();
  }

  async parseAsBankAccount(): Promise<void> {
    logger.groupCollapsed(
      'parseAsBankAccount: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting bank account parsing');

    const errorMessageKey =
      "engine.importStatement.can't-parse-as-bank-account";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(
        ColumnDefinition.BANK_ACCOUNT,
        errorMessageKey
      )
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    logger.debug(
      'Calling parseGeneric with bank account-specific parsing function'
    );
    // Use the generic parsing method with a bank account-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.BANK_ACCOUNT,
      errorMessageKey,
      params: {},
      name: $t('engine.importStatement.column.bank-account'),
      parseFunction: (cell) => {
        // Check for null values first
        if (
          cell.value === null ||
          cell.value === undefined ||
          cell.value === ''
        ) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        } else {
          // Convert to string
          return {
            value: String(cell.value),
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsBankAccount completed successfully');
    logger.groupEnd();
  }

  async parseAsTransactionStatus(
    params: TransactionStatusColumnParams
  ): Promise<void> {
    logger.groupCollapsed(
      'parseAsTransactionStatus: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting transaction status parsing with params:', params);

    const errorMessageKey = "engine.importStatement.can't-parse-as-status";

    logger.debug('Validating column');
    this.validate();
    const stage2 = this._stage2;
    if (!stage2) {
      throw new Error(
        `Column ${this.id} is not associated with a stage2 instance`
      );
    }

    logger.debug('Checking if transformation is valid');
    if (this.validateTransformation(ColumnDefinition.STATUS, errorMessageKey)) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // If successValue is explicitly provided, use it
    logger.debug('Checking if successValue is explicitly provided');
    if (params.successValue !== 'auto' && params.successValue.useValue) {
      const successValue = params.successValue.useValue;
      logger.debug('Using explicit successValue:', successValue);

      // Create a new copy of column with the new data and status definition
      logger.debug(
        'Creating new column with STATUS definition and explicit success value'
      );
      const statusColumn = this.copy({
        name: $t('engine.importStatement.column.status'),
        definition: ColumnDefinition.STATUS,
        params: params,
        data: this.data.map((cell) => {
          const isSuccess = cell.value === successValue;
          return {
            value: cell.value,
            type: SupportedDataType.TEXT,
            ignore: !isSuccess
              ? $t('engine.importStatement.status-value-ignored', {
                  value:
                    cell.value !== null && cell.value !== undefined
                      ? String(cell.value)
                      : '',
                  successValue: successValue,
                })
              : undefined,
          };
        }),
      });

      // Apply new column to the stage
      logger.debug('Applying status column to stage');
      stage2.applyColumn(statusColumn);
      logger.debug(
        'parseAsTransactionStatus completed successfully with explicit success value'
      );
      logger.groupEnd();
      return;
    }

    // Auto-detect success value
    logger.debug('Auto-detecting success value');
    // Count occurrences of each value
    logger.debug('Counting occurrences of each value');
    const valueCounts: Record<string, number> = {};
    let totalNonNullValues = 0;

    for (const cell of this.data) {
      if (cell.value === null || cell.value === undefined) {
        continue;
      }

      const stringValue = String(cell.value);
      valueCounts[stringValue] = (valueCounts[stringValue] || 0) + 1;
      totalNonNullValues++;
    }

    // Find the most common value
    logger.debug('Finding the most common value');
    let mostCommonValue: string | null = null;
    let maxCount = 0;

    for (const [value, count] of Object.entries(valueCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonValue = value;
      }
    }
    logger.debug(
      'Most common value:',
      mostCommonValue,
      'with count:',
      maxCount
    );

    // Check if the most common value exceeds the threshold
    logger.debug('Checking if most common value exceeds threshold');
    const threshold = getEngineConfig().successStatusThreshold;
    logger.debug('Success status threshold:', threshold);

    if (
      totalNonNullValues === 0 ||
      mostCommonValue === null ||
      maxCount / totalNonNullValues < threshold
    ) {
      logger.debug('Threshold check failed, throwing exception');
      logger.groupEnd();
      throw new LocalizableException(
        $t("engine.importStatement.can't-parse-as-status", {
          message: $t('engine.importStatement.no-dominant-status-value', {
            threshold: (threshold * 100).toFixed(0),
          }),
        })
      );
    }
    logger.debug('Threshold check passed');

    // Create a new copy of column with the new data and status definition
    logger.debug(
      'Creating new column with STATUS definition and auto-detected success value'
    );
    const statusColumn = this.copy({
      name: $t('engine.importStatement.column.status'),
      definition: ColumnDefinition.STATUS,
      params: {
        ...params,
        successValue: { useValue: mostCommonValue },
      },
      data: this.data.map((cell) => {
        const isSuccess =
          cell.value !== null &&
          cell.value !== undefined &&
          String(cell.value) === mostCommonValue;
        return {
          value: cell.value,
          type: SupportedDataType.TEXT,
          ignore: !isSuccess
            ? $t('engine.importStatement.status-value-ignored', {
                value:
                  cell.value !== null && cell.value !== undefined
                    ? String(cell.value)
                    : '',
                successValue: mostCommonValue,
              })
            : undefined,
        };
      }),
    });

    // Apply new column to the stage
    logger.debug('Applying status column to stage');
    stage2.applyColumn(statusColumn);

    logger.debug(
      'parseAsTransactionStatus completed successfully with auto-detected success value'
    );
    logger.groupEnd();
  }

  async parseAsExchangeRate(): Promise<void> {
    logger.groupCollapsed(
      'parseAsExchangeRate: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting exchange rate parsing');

    const errorMessageKey =
      "engine.importStatement.can't-parse-as-exchange-rate";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(
        ColumnDefinition.EXCHANGE_RATE,
        errorMessageKey
      )
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    logger.debug(
      'Calling parseGeneric with exchange rate-specific parsing function'
    );
    // Use the generic parsing method with an exchange rate-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.EXCHANGE_RATE,
      errorMessageKey,
      params: null,
      name: $t('engine.importStatement.column.exchange-rate'),
      parseFunction: (cell) => {
        // Check for null or NaN values first
        if (isNan(cell.value)) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        }

        // If the value is already a number, use it as is
        let numberValue: number;
        if (typeof cell.value === 'number') {
          numberValue = cell.value;
        } else {
          // Otherwise, parse it as a string
          const stringValue = String(cell.value);
          numberValue = parseNumber(stringValue);
        }

        if (!isNaN(numberValue)) {
          // Successfully parsed as number
          return {
            value: numberValue,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        } else {
          // Parse failed - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.exchange-rate-parse-failed', {
                value: String(cell.value),
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsExchangeRate completed successfully');
    logger.groupEnd();
  }

  async parseAsBankCommission(
    params: BankCommissionColumnParams
  ): Promise<void> {
    logger.groupCollapsed(
      'parseAsBankCommission: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting bank commission parsing with params:', params);

    const errorMessageKey =
      "engine.importStatement.can't-parse-as-bank-commission";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(
        ColumnDefinition.BANK_COMMISSION,
        errorMessageKey
      )
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Determine column name based on currency parameter
    let columnName: LocalizableMessage;
    if (params.currency === 'auto') {
      columnName = $t('engine.importStatement.column.bank-commission');
    } else if (params.currency === 'use_base') {
      columnName = $t(
        'engine.importStatement.column.bank-commission-in-base-currency'
      );
    } else {
      columnName = $t(
        'engine.importStatement.column.bank-commission-in-currency',
        { currency: params.currency.code }
      );
    }

    logger.debug(
      'Calling parseGeneric with bank commission-specific parsing function'
    );
    // Use the generic parsing method with a bank commission-specific parsing function
    // and specify to count only non-null values for error percentage calculation
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.BANK_COMMISSION,
      errorMessageKey,
      params,
      name: columnName,
      parseFunction: (cell) => {
        // Check for null or NaN values first
        if (isNan(cell.value)) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        }

        // If the value is already a number, use it as is
        let numberValue: number;
        if (typeof cell.value === 'number') {
          numberValue = cell.value;
        } else {
          // Otherwise, parse it as a string
          const stringValue = String(cell.value);
          numberValue = parseNumber(stringValue);
        }

        if (!isNaN(numberValue)) {
          // Successfully parsed as number
          return {
            value: numberValue,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        } else {
          // Parse failed - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t(
                'engine.importStatement.bank-commission-parse-failed',
                { value: String(cell.value) }
              ),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsBankCommission completed successfully');
    logger.groupEnd();
  }

  async parseAsCashback(params: CashbackColumnParams): Promise<void> {
    logger.groupCollapsed(
      'parseAsCashback: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting cashback parsing with params:', params);

    const errorMessageKey = "engine.importStatement.can't-parse-as-cashback";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(ColumnDefinition.CASHBACK, errorMessageKey)
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // Determine column name based on currency parameter
    let columnName: LocalizableMessage;
    if (params.currency === 'auto') {
      columnName = $t('engine.importStatement.column.cashback');
    } else if (params.currency === 'use_base') {
      columnName = $t(
        'engine.importStatement.column.cashback-in-base-currency'
      );
    } else {
      columnName = $t('engine.importStatement.column.cashback-in-currency', {
        currency: params.currency.code,
      });
    }

    logger.debug(
      'Calling parseGeneric with cashback-specific parsing function'
    );
    // Use the generic parsing method with a cashback-specific parsing function
    // and specify to count only non-null values for error percentage calculation
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.CASHBACK,
      errorMessageKey,
      params,
      name: columnName,
      parseFunction: (cell) => {
        // Check for null or NaN values first
        if (isNan(cell.value)) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        }

        // If the value is already a number, use it as is
        let numberValue: number;
        if (typeof cell.value === 'number') {
          numberValue = cell.value;
        } else {
          // Otherwise, parse it as a string
          const stringValue = String(cell.value);
          numberValue = parseNumber(stringValue);
        }

        if (!isNaN(numberValue)) {
          // Successfully parsed as number
          return {
            value: numberValue,
            type: SupportedDataType.NUMBER,
          } satisfies CellData;
        } else {
          // Parse failed - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.cashback-parse-failed', {
                value: String(cell.value),
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsCashback completed successfully');
    logger.groupEnd();
  }

  async undo(): Promise<void> {
    logger.groupCollapsed('undo: column=', this.name, ', id=', this.id);
    logger.debug('Starting undo operation');

    logger.debug('Validating column');
    this.validate();
    const stage2 = this._stage2;
    if (!stage2) {
      throw new Error(
        `Column ${this.id} is not associated with a stage2 instance`
      );
    }

    // If the column has no definition (not transformed yet), nothing to undo
    logger.debug('Checking if column has a definition');
    if (this.definition === null) {
      logger.debug('Column has no definition, nothing to undo');
      logger.groupEnd();
      return;
    }

    logger.debug('Calling resetColumn on stage2 instance');
    // Call resetColumn on the stage2 instance to reset this column to its initial state
    await stage2.resetColumn(this.id);

    logger.debug('Undo operation completed successfully');
    logger.groupEnd();
  }

  async parseAsMerchant(): Promise<void> {
    logger.groupCollapsed(
      'parseAsMerchant: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting merchant category parsing');

    const errorMessageKey = "engine.importStatement.can't-parse-as-merchant";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(
        ColumnDefinition.MERCHANT_CATEGORY,
        errorMessageKey
      )
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    logger.debug(
      'Calling parseGeneric with merchant-specific parsing function'
    );
    // Use the generic parsing method with a merchant-specific parsing function
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.MERCHANT_CATEGORY,
      errorMessageKey,
      params: null,
      name: $t('engine.importStatement.column.merchant'),
      parseFunction: (cell) => {
        // Treat null or empty values as errors
        if (
          cell.value === null ||
          cell.value === undefined ||
          cell.value === ''
        ) {
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.merchant-parse-failed', {
                value: 'empty',
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }

        let isValid = false;
        let mccValue: number | string = cell.value;

        // If it's a string, check if it's a 4-digit string
        if (typeof cell.value === 'string') {
          const stringValue = cell.value.trim();
          // Check if it's a 4-digit string
          if (/^\d{1,4}$/.test(stringValue)) {
            mccValue = stringValue;
            isValid = true;
          }
        }
        // If it's a number, check if it's between 1 and 9999
        else if (typeof cell.value === 'number') {
          const numValue = cell.value;
          if (Number.isInteger(numValue) && numValue >= 1 && numValue <= 9999) {
            mccValue = numValue;
            isValid = true;
          }
        }
        // Try to parse as number if it's not already a valid string or number
        else {
          try {
            const stringValue = String(cell.value).trim();
            // Check if it's a 4-digit string
            if (/^\d{1,4}$/.test(stringValue)) {
              mccValue = stringValue;
              isValid = true;
            } else {
              // Try to parse as number
              const numValue = parseNumber(stringValue);
              if (
                !isNan(numValue) &&
                Number.isInteger(numValue) &&
                numValue >= 1 &&
                numValue <= 9999
              ) {
                mccValue = numValue;
                isValid = true;
              }
            }
          } catch {
            isValid = false;
          }
        }

        if (isValid) {
          // Successfully validated as a merchant category code
          // Format as a 4-digit string with leading zeros
          const formattedMCC =
            typeof mccValue === 'number'
              ? mccValue.toString().padStart(4, '0')
              : mccValue.padStart(4, '0');

          return {
            value: formattedMCC,
            type: SupportedDataType.MCC,
          } satisfies CellData;
        } else {
          // Invalid value - use old value and set error
          return {
            value: cell.value,
            error: $t(errorMessageKey, {
              message: $t('engine.importStatement.merchant-parse-failed', {
                value: String(cell.value),
              }),
            }),
            type: cell.type,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsMerchant completed successfully');
    logger.groupEnd();
  }

  // ── EXTENDED TRANSFORMS (ENT-009 additions, 2.2) ──────────────────────────

  /**
   * Marks this column as TIME — recognized-and-IGNORED.
   *
   * TIME is a label-only transform: any cell content is acceptable (no validation
   * of time syntax), and the transform produces NO output cells (data is discarded).
   * The column is marked with ColumnDefinition.TIME in the stage, but its data array
   * is left empty so that downstream row processing emits no time field (ENT-001,
   * privacy: time-of-day must not appear in the export).
   *
   * Pattern mirrors existing transforms: validate → copy with empty data → applyColumn.
   */
  async parseAsTime(): Promise<void> {
    logger.groupCollapsed('parseAsTime: column=', this.name, ', id=', this.id);
    logger.debug('Starting time column labeling (data discarded)');

    logger.debug('Validating column');
    this.validate();
    const stage2 = this._stage2;
    if (!stage2) {
      throw new Error(
        `Column ${this.id} is not associated with a stage2 instance`
      );
    }

    const errorMessageKey = "engine.importStatement.can't-parse-as-time";

    logger.debug('Checking if transformation is valid');
    if (this.validateTransformation(ColumnDefinition.TIME, errorMessageKey)) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    // TIME: label the column but emit NO output cells (data dropped, ENT-001).
    logger.debug('Creating TIME column with empty data (cells discarded)');
    const timeColumn = this.copy({
      name: $t('engine.importStatement.column.time'),
      definition: ColumnDefinition.TIME,
      params: {},
      data: [],
    });

    logger.debug('Applying time column to stage');
    stage2.applyColumn(timeColumn);

    logger.debug('parseAsTime completed successfully');
    logger.groupEnd();
  }

  /**
   * Transforms this column as COUNTERPARTY — distinct from DESCRIPTION.
   *
   * COUNTERPARTY is a DESCRIPTION-like text transform: null/empty/undefined cells
   * map to null; all other values are stringified.  The output writes to the
   * `counterparty` field in the typed row (ENT-006) — distinct from `description`.
   *
   * SupportedDataType: TEXT (same as DESCRIPTION, per Task 2 decision; no new member
   * needed in the enum).
   *
   * Pattern mirrors `parseAsDescription` exactly, with ColumnDefinition.COUNTERPARTY
   * and the counterparty column name key.
   */
  async parseAsCounterparty(): Promise<void> {
    logger.groupCollapsed(
      'parseAsCounterparty: column=',
      this.name,
      ', id=',
      this.id
    );
    logger.debug('Starting counterparty parsing');

    const errorMessageKey =
      "engine.importStatement.can't-parse-as-counterparty";

    logger.debug('Validating column');
    this.validate();

    logger.debug('Checking if transformation is valid');
    if (
      this.validateTransformation(
        ColumnDefinition.COUNTERPARTY,
        errorMessageKey
      )
    ) {
      logger.debug('Transformation already done, returning early');
      logger.groupEnd();
      return;
    }

    logger.debug(
      'Calling parseGeneric with counterparty-specific parsing function'
    );
    // DESCRIPTION-like text transform → counterparty output field (ENT-006).
    await this.parseGeneric({
      targetDefinition: ColumnDefinition.COUNTERPARTY,
      errorMessageKey,
      params: {},
      name: $t('engine.importStatement.column.counterparty'),
      parseFunction: (cell) => {
        // Check for null values first
        if (
          cell.value === null ||
          cell.value === undefined ||
          cell.value === ''
        ) {
          // Map to null
          return {
            value: null,
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        } else {
          // Convert to string
          return {
            value: String(cell.value),
            type: SupportedDataType.TEXT,
          } satisfies CellData;
        }
      },
    });
    logger.debug('parseAsCounterparty completed successfully');
    logger.groupEnd();
  }
}

// ── Module-level helpers for CurrencyCache → 1.6 wiring ────────────────────
//
// The prior art's parseAsCurrency distinguished alpha-code vs symbol matches
// by checking `currencies.find(c => c.code.toUpperCase() === upper)` (which only
// matched exact ISO codes) before falling through to symbol matching.
// In the 1.6 reference module, `symbolToIso` does code passthrough AND symbol
// lookup in a single call, so we need a separate predicate to know whether a
// match was a CODE match (to preserve the alpha-code → symbol ordering).
//
// `byCode_has(upper)` answers: "is `upper` an exact ISO alpha code?"
// It calls `symbolToIso` and then checks if the result matches the input (code
// passthrough case), which is equivalent to checking the internal `byCode` map.
function byCode_has(upper: string): boolean {
  const result = symbolToIso(upper);
  return result !== undefined && result === upper;
}
