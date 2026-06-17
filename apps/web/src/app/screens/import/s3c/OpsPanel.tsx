/**
 * OpsPanel — the categorization review table.  Dynamic columns (driven by the
 * available ConditionFieldDTO list), an optional filter-strip (when a draft is
 * active), the All/Uncat segment + total toolbar, a CategoryCell per row, and
 * pagination.  Bound to CategorizedRowDTO[] + a Map<id, CategoryDTO>.
 *
 * KEYING: each row is keyed on `row.rowIndex` (the stable identity from the
 * import), NEVER the array index — the window slides under us.
 * MCC: the mcc column renders `mccTitle(mcc, lang)` (localized reference title).
 * CONTENT (description / counterparty / amount) is user data → NOT translated.
 */
import { useState } from 'react';
import { CategoryCell } from './CategoryCell';
import { ColumnFunnel } from './ColumnFunnel';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import { condText, formatOpDate } from './labels';
import { Panel, PanelHeader } from '../../../../ui/altus/components/Panel';
import { useT } from '../../../i18n/LangProvider';
import { mccTitle } from '../../../mcc/mcc-lookup';
import type { CategorizedRowDTO, CategoryDTO, ConditionDTO, ConditionFieldDTO } from '@abc-budget/engine';
import './s3c.css';

export type OpsSegment = 'all' | 'uncat';

export interface OpsPanelProps {
  rows: CategorizedRowDTO[];
  fields: ConditionFieldDTO[];
  categories: Map<string, CategoryDTO>;
  total: number;
  matchCount: number;
  segment: OpsSegment;
  onSegment: (segment: OpsSegment) => void;
  page: number;
  onPage: (page: number) => void;
  /** The active draft conditions (filter-strip shows them when non-empty). */
  draft: ConditionDTO[];
  /** Header funnel → seed a draft condition (field+operator). */
  onAddCondition: (field: string, operator: string) => void;
  onCellClick: (rowIndex: number) => void;
  lang: 'uk' | 'en';
}

const PAGE_SIZE = 12;
const CURRENCY_SYMBOL: Record<string, string> = { UAH: '₴', USD: '$', EUR: '€', GBP: '£' };

function fmtAmount(amount: number, currency: string): string {
  const v = Math.abs(amount)
    .toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/ /g, ' ');
  return `${amount < 0 ? '−' : ''}${v} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

function colHeaderKey(
  field: string,
): 's3cColDate' | 's3cColDesc' | 's3cColAmount' | 's3cColMcc' | 's3cColAccount' | 's3cColCounterparty' | 's3cColCurrency' | null {
  switch (field) {
    case 'date':
      return 's3cColDate';
    case 'description':
      return 's3cColDesc';
    case 'amount':
      return 's3cColAmount';
    case 'mcc':
      return 's3cColMcc';
    case 'account':
      return 's3cColAccount';
    case 'counterparty':
      return 's3cColCounterparty';
    case 'currency':
      return 's3cColCurrency';
    default:
      return null;
  }
}

/** A field's cell value for a row.  Content is verbatim user data (never i18n). */
function cellValue(row: CategorizedRowDTO, field: string, lang: 'uk' | 'en'): string {
  switch (field) {
    case 'date':
      return formatOpDate(row.date); // MM-DD — chrome formatting, not content
    case 'amount':
      return fmtAmount(row.amount, row.currency);
    case 'description':
      return row.description ?? '—';
    case 'mcc':
      return mccTitle(row.mcc, lang);
    case 'currency':
      return row.currency; // the code (UAH/USD) — content, never i18n
    case 'account':
      return row.account ?? '—';
    case 'counterparty':
      return row.counterparty ?? '—';
    case 'category':
      return row.bankCategory ?? '—';
    default:
      return '—';
  }
}

export function OpsPanel({
  rows,
  fields,
  categories,
  total,
  matchCount,
  segment,
  onSegment,
  page,
  onPage,
  draft,
  onAddCondition,
  onCellClick,
  lang,
}: OpsPanelProps) {
  const t = useT();
  const [openFunnel, setOpenFunnel] = useState<string | null>(null);
  const activeFields = new Set(draft.map((c) => c.field));

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const pageRows = rows.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);

  return (
    <Panel className="opspanel">
      <PanelHeader logchip="OPS/" title={t('s3cOpsTitle')} />

      {draft.length > 0 && (
        <div className="filter-strip">
          <span className="fs-lab f-mono">{t('s3cFilterLabel')}:</span>
          <span className="fs-conds f-mono">
            {draft.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="fs-and">AND</span>}
                <span className="fs-cond">{condText(c, t)}</span>
              </span>
            ))}
          </span>
          <span className="fs-count f-mono">{t('s3cOpsTotal', { n: matchCount })}</span>
        </div>
      )}

      <div className="ops-toolbar">
        <div className="seg ops-seg">
          <button
            type="button"
            className={`seg-btn${segment === 'all' ? ' on' : ''}`}
            aria-pressed={segment === 'all'}
            onClick={() => {
              onSegment('all');
              onPage(0);
            }}
          >
            {t('s3cSegAll')}
          </button>
          <button
            type="button"
            className={`seg-btn${segment === 'uncat' ? ' on' : ''}`}
            aria-pressed={segment === 'uncat'}
            onClick={() => {
              onSegment('uncat');
              onPage(0);
            }}
          >
            {t('s3cSegUncat')}
          </button>
        </div>
        <span className="ops-count f-mono">{t('s3cOpsTotal', { n: total })}</span>
      </div>

      <div className="opsscroll">
        <table className="opstable">
          <thead>
            <tr>
              {fields.map((f) => {
                const headerKey = colHeaderKey(f.field);
                return (
                  <th key={f.field} className={f.field === 'amount' ? 'th-amt' : ''}>
                    <div className="th-inner">
                      <span className="th-lab">{headerKey ? t(headerKey) : f.field}</span>
                      <ColumnFunnel
                        field={f}
                        active={activeFields.has(f.field)}
                        onPick={(operator) => onAddCondition(f.field, operator)}
                        isOpen={openFunnel === f.field}
                        onToggle={() => setOpenFunnel((cur) => (cur === f.field ? null : f.field))}
                        lang={lang}
                      />
                    </div>
                  </th>
                );
              })}
              <th className="th-cat">{t('s3cColCat')}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={fields.length + 1} className="ops-empty f-mono">
                  — {t('s3cOpsEmpty')} —
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const category = row.categoryId != null ? categories.get(row.categoryId) : undefined;
                return (
                  <tr key={row.rowIndex} className={category ? '' : 'op-uncat'}>
                    {fields.map((f) => (
                      <td
                        key={f.field}
                        className={
                          f.field === 'amount'
                            ? 'op-amt amount'
                            : f.field === 'description'
                              ? 'op-desc f-mono'
                              : 'op-cell f-mono'
                        }
                      >
                        {f.field === 'description' ? (
                          <span className="desc-wrap">
                            <span className="desc-val">{cellValue(row, f.field, lang)}</span>
                          </span>
                        ) : (
                          cellValue(row, f.field, lang)
                        )}
                      </td>
                    ))}
                    <td className="op-cat">
                      <CategoryCell
                        category={category}
                        isManual={row.isManual === 1}
                        onClick={() => onCellClick(row.rowIndex)}
                        lang={lang}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="ops-pager">
        <button
          type="button"
          className="pgkey"
          disabled={pg <= 0}
          onClick={() => onPage(pg - 1)}
          aria-label={t('s3cPrev')}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="pg-disp f-mono">{t('s3cPageOf', { n: pg + 1, m: pages })}</span>
        <button
          type="button"
          className="pgkey"
          disabled={pg >= pages - 1}
          onClick={() => onPage(pg + 1)}
          aria-label={t('s3cNextPage')}
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>
    </Panel>
  );
}
