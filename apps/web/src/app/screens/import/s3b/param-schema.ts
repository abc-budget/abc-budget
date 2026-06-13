/**
 * param-schema.ts — S3b param-schema definition + engine param builders.
 *
 * PARAM_SCHEMA drives the «More» ConfigWizard UI fields.
 * buildEngineParams converts the UI field values into the exact engine param
 * object that importApplyColumn accepts.
 *
 * Engine param shapes (NOT imported here — NFR-003 fence; shapes asserted
 * structurally in the spec):
 *   DateColumnParams         { format: 'auto' | { custom: string } }
 *   AmountColumnParams       { currency: 'auto' | 'use_base' | { code: string };
 *                              type: 'income' | 'outcome' | 'mixed' | 'auto' }
 *   BalanceColumnParams      { currency: 'auto' | 'use_base' | { code: string } }
 *   BankCommissionColumnParams { currency: 'auto' | 'use_base' | { code: string } }
 *   CashbackColumnParams     { currency: 'auto' | 'use_base' | { code: string } }
 *   TransactionStatusColumnParams { successValue: 'auto' | { useValue: string } }
 *
 * Everything else (description, currency, balance, bank_account, merchant_category,
 * exchange_rate, category, time, counterparty, ignore): no params → null.
 *
 * Source: design-reference/s3b-data.jsx :: PARAM_SCHEMA + paramDefaults
 */

/* ── Field option types ─────────────────────────────────────────────────── */

export interface ParamFieldOption {
  val: string;
  label: { uk: string; en: string };
  hint?: { uk: string; en: string };
}

export interface ParamFieldCustom {
  /** The option `val` that activates the custom input. */
  when: string;
  /** 'text' = free-text input; 'select' = dynamic select (populated at runtime). */
  kind: 'text' | 'select';
  placeholder?: string;
  label: { uk: string; en: string };
}

export interface ParamField {
  key: string;
  label: { uk: string; en: string };
  /** Default value for this field. */
  def: string;
  options: ParamFieldOption[];
  /** Optional custom-value sub-field shown when a specific option is selected. */
  custom?: ParamFieldCustom;
}

/* ── Shared CURRENCY field (reused for amount/balance/commission/cashback) ── */

const CURRENCY_FIELD: ParamField = {
  key: 'currency',
  label: { uk: 'Валюта', en: 'Currency' },
  def: 'auto',
  options: [
    { val: 'auto',     label: { uk: 'Авто (з колонки)', en: 'Auto (from column)' } },
    { val: 'use_base', label: { uk: 'Базова валюта',    en: 'Base currency' } },
    { val: 'code',     label: { uk: 'Фікс. код…',       en: 'Fixed code…' } },
  ],
  custom: {
    when: 'code',
    kind: 'text',
    placeholder: 'USD',
    label: { uk: 'ISO-код', en: 'ISO code' },
  },
};

/* ── PARAM_SCHEMA ────────────────────────────────────────────────────────── */

/**
 * Maps column type names (matching engine ColumnDefinition strings) to their
 * configurable UI fields. Types absent from this map have no params.
 *
 * Ported verbatim from design-reference/s3b-data.jsx :: PARAM_SCHEMA.
 */
export const PARAM_SCHEMA: Record<string, ParamField[]> = {
  date: [
    {
      key: 'format',
      label: { uk: 'Формат дати', en: 'Date format' },
      def: 'auto',
      options: [
        { val: 'auto',   label: { uk: 'Авто', en: 'Auto' } },
        { val: 'custom', label: { uk: 'Власний…', en: 'Custom…' } },
      ],
      custom: {
        when: 'custom',
        kind: 'text',
        placeholder: 'YYYY-MM-DD',
        label: { uk: 'Шаблон', en: 'Pattern' },
      },
    },
  ],
  amount: [
    CURRENCY_FIELD,
    {
      key: 'type',
      label: { uk: 'Тип значення', en: 'Value type' },
      def: 'auto',
      options: [
        { val: 'income',  label: { uk: 'Дохід', en: 'Income' },
          hint: { uk: 'усі додатні · ABC поки не рахує дохід', en: 'all positive · ABC doesn’t count income yet' } },
        { val: 'outcome', label: { uk: 'Витрати', en: 'Outcome' },
          hint: { uk: 'списання, усі додатні', en: 'debits, all positive' } },
        { val: 'mixed',   label: { uk: 'Змішаний', en: 'Mixed' },
          hint: { uk: '+ дохід / − витрата (за знаком)', en: '+ income / − expense (by sign)' } },
        { val: 'auto',    label: { uk: 'Авто', en: 'Auto' },
          hint: { uk: 'визначити: витрати чи змішаний', en: 'detect: outcome vs mixed' } },
      ],
    },
  ],
  balance:     [CURRENCY_FIELD],
  bank_commission: [CURRENCY_FIELD],
  cashback:    [CURRENCY_FIELD],
  status: [
    {
      key: 'successValue',
      label: { uk: 'Значення успіху', en: 'Success value' },
      def: 'auto',
      options: [
        { val: 'auto',     label: { uk: 'Авто', en: 'Auto' } },
        { val: 'useValue', label: { uk: 'Обрати значення…', en: 'Pick a value…' } },
      ],
      custom: {
        when: 'useValue',
        kind: 'select',
        label: { uk: 'Яке значення = успіх', en: 'Which value = success' },
      },
    },
  ],
};

/**
 * Returns the param fields for a given column type.
 * Returns [] for types with no configurable params.
 */
export function paramSchema(type: string): ParamField[] {
  return PARAM_SCHEMA[type] ?? [];
}

/**
 * Returns the default UI field values for a given column type.
 * E.g. date → { format: 'auto' }; amount → { currency: 'auto', type: 'auto' }
 */
export function paramDefaults(type: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of paramSchema(type)) {
    out[field.key] = field.def;
  }
  return out;
}

/* ── UI field value types ────────────────────────────────────────────────── */

/**
 * The UI stores one extra "customValue" per field when the 'code' / 'custom' /
 * 'useValue' option is selected. The builder receives:
 *
 *   uiValues: { [fieldKey]: selectedOption, [fieldKey + 'Custom']: customText }
 *
 * Naming convention: currency → currencyCustom for the ISO code;
 *                    format  → formatCustom for the date pattern;
 *                    successValue → successValueCustom for the status value.
 */
export type UiValues = Record<string, string>;

/* ── Engine param shapes (structural, not imported) ─────────────────────── */
// These types are defined HERE to match the engine's internal params.
// The engine types (DateColumnParams, etc.) are NOT imported (NFR-003 fence).
// Shape correctness is asserted in param-schema.spec.ts.

type CurrencyParam = 'auto' | 'use_base' | { code: string };

/** Engine: DateColumnParams */
interface BuiltDateParams {
  format: 'auto' | { custom: string };
}

/** Engine: AmountColumnParams */
interface BuiltAmountParams {
  currency: CurrencyParam;
  type: 'income' | 'outcome' | 'mixed' | 'auto';
}

/** Engine: BalanceColumnParams / BankCommissionColumnParams / CashbackColumnParams */
interface BuiltCurrencyOnlyParams {
  currency: CurrencyParam;
}

/**
 * Engine: TransactionStatusColumnParams.
 * The explicit choice MUST be the WRAPPED `{ useValue: string }` shape — the
 * engine's parse guard is `params.successValue !== 'auto' && params.successValue.useValue`
 * (column.ts:1261). A bare string passes the `!== 'auto'` clause but its `.useValue`
 * is undefined, so the engine SILENTLY falls back to auto-detect, discarding the
 * user's explicit success value (2.8 QA MAJOR-2, HC-7).
 */
interface BuiltStatusParams {
  successValue: 'auto' | { useValue: string };
}

/** Resolves the currency UI value + optional custom ISO code → engine CurrencyParam. */
function buildCurrency(uiValues: UiValues, fieldKey: string): CurrencyParam {
  const selected = uiValues[fieldKey] ?? 'auto';
  if (selected === 'auto' || selected === 'use_base') return selected;
  if (selected === 'code') {
    const code = (uiValues[`${fieldKey}Custom`] ?? '').trim().toUpperCase() || 'USD';
    return { code };
  }
  // Fallback: treat as literal (should not happen with a valid schema)
  return 'auto';
}

/**
 * Converts UI wizard field values into the exact engine param object accepted
 * by importApplyColumn(sessionId, columnId, definition, params).
 *
 * Returns null for types with no params (description, currency, bank_account,
 * merchant_category, exchange_rate, category, time, counterparty, ignore, and
 * any unknown type).
 *
 * @param type       — engine ColumnDefinition string (e.g. 'date', 'amount',
 *                     'bank_commission')
 * @param uiValues   — the wizard's field-key→selected-option map, plus
 *                     <key>Custom entries for free-text/select custom values
 */
export function buildEngineParams(
  type: string,
  uiValues: UiValues,
): Record<string, unknown> | null {
  switch (type) {
    case 'date': {
      const format = uiValues['format'] ?? 'auto';
      if (format === 'custom') {
        const pattern = (uiValues['formatCustom'] ?? '').trim() || 'yyyy-MM-dd';
        return { format: { custom: pattern } } satisfies BuiltDateParams;
      }
      return { format: 'auto' } satisfies BuiltDateParams;
    }

    case 'amount': {
      const currency = buildCurrency(uiValues, 'currency');
      const type_ = (uiValues['type'] ?? 'auto') as BuiltAmountParams['type'];
      return { currency, type: type_ } satisfies BuiltAmountParams;
    }

    case 'balance':
    case 'bank_commission':
    case 'cashback': {
      const currency = buildCurrency(uiValues, 'currency');
      return { currency } satisfies BuiltCurrencyOnlyParams;
    }

    case 'status': {
      const selected = uiValues['successValue'] ?? 'auto';
      if (selected === 'useValue') {
        const value = (uiValues['successValueCustom'] ?? '').trim();
        // Explicit choice → the WRAPPED { useValue } shape the engine guard checks
        // (column.ts:1261). A bare string would be silently dropped to auto-detect
        // (2.8 QA MAJOR-2). Empty custom → 'auto' (nothing to honor).
        return value
          ? ({ successValue: { useValue: value } } satisfies BuiltStatusParams)
          : ({ successValue: 'auto' } satisfies BuiltStatusParams);
      }
      return { successValue: 'auto' } satisfies BuiltStatusParams;
    }

    default:
      // description, currency, bank_account, merchant_category, exchange_rate,
      // category, time, counterparty, ignore — no configurable params.
      return null;
  }
}
