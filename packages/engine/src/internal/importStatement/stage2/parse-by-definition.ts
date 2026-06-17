/**
 * parse-by-definition — the SHARED `definition → col.parseAsX(params)` dispatch.
 * @module importStatement/stage2/parse-by-definition
 * @internal
 *
 * Extracted (Story 4.9a.1) from the inline switch in `client/direct-client.ts`
 * (`applyDefinition`) so there is ONE dispatcher, called by BOTH:
 *   - the INTERACTIVE path (`importApplyColumn`) — unchanged behavior: the
 *     parse runs, then `parseGeneric → stage2.applyColumn` does the
 *     `guessed → confirmed` transition + the staged pool write (the 2.3
 *     learning loop).
 *   - the RECALL MOUNT (`service.stage2`, via
 *     `ImportStatementColumn.parseFromRecall`) — the cells are parsed at mount
 *     so recalled DATE/AMOUNT/… columns carry typed values (a `Date`, a
 *     `number`) instead of raw strings, WITHOUT confirming or staging.
 *
 * The 2.4 threshold gate (`ColumnTransformRejection`) fires from the underlying
 * `parseAsX` exactly as before — this is a pure lift, no behavior change for the
 * interactive caller.
 */

import { ColumnDefinition } from '../types';
import type {
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  DateColumnParams,
  TransactionStatusColumnParams,
} from '../types';
import type { ImportStatementColumn } from './column';

/**
 * Dispatch a column definition to the matching `ImportStatementColumn` transform.
 *
 * This is the SAME parse path the ported suites exercise (parseAs*), so the 2.4
 * threshold gate (ColumnTransformRejection) and — for the interactive caller —
 * the 2.3 recall learning loop (savePool at applyColumn time) both fire.
 *
 * @param col        The live column instance to transform.
 * @param definition The target column definition (wire string ⇒ ColumnDefinition).
 * @param params     The column params (shape per definition; may be null).
 * @throws Error on an unknown definition (loud — never silent).
 */
export async function parseColumnByDefinition(
  col: ImportStatementColumn,
  definition: string,
  params: Record<string, unknown> | null,
): Promise<void> {
  switch (definition as ColumnDefinition) {
    case ColumnDefinition.DATE:
      return col.parseAsDate((params as unknown as DateColumnParams) ?? { format: 'auto' });
    case ColumnDefinition.AMOUNT:
      return col.parseAsAmount(params as unknown as AmountColumnParams);
    case ColumnDefinition.CURRENCY:
      return col.parseAsCurrency();
    case ColumnDefinition.DESCRIPTION:
      return col.parseAsDescription();
    case ColumnDefinition.COUNTERPARTY:
      return col.parseAsCounterparty();
    case ColumnDefinition.MERCHANT_CATEGORY:
      return col.parseAsMerchant();
    case ColumnDefinition.CATEGORY:
      return col.parseAsBankCategory();
    case ColumnDefinition.BALANCE:
      return col.parseAsBalance(params as unknown as BalanceColumnParams);
    case ColumnDefinition.BANK_ACCOUNT:
      return col.parseAsBankAccount();
    case ColumnDefinition.STATUS:
      return col.parseAsTransactionStatus(params as unknown as TransactionStatusColumnParams);
    case ColumnDefinition.EXCHANGE_RATE:
      return col.parseAsExchangeRate();
    case ColumnDefinition.BANK_COMMISSION:
      return col.parseAsBankCommission(params as unknown as BankCommissionColumnParams);
    case ColumnDefinition.CASHBACK:
      return col.parseAsCashback(params as unknown as CashbackColumnParams);
    case ColumnDefinition.TIME:
      return col.parseAsTime();
    case ColumnDefinition.IGNORE:
      return col.ignore();
    default:
      throw new Error(`[abc-engine] Unknown column definition: '${definition}'`);
  }
}
