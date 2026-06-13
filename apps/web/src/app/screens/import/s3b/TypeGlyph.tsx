import type { ReactNode } from 'react';

/**
 * TypeGlyph — the per-column-type SVG glyph.
 *
 * Ported from design-reference/s3b-data.jsx :: TYPES[*].glyph (the `ICO()`
 * path sets) and s3b-app.jsx :: TypeGlyph.  Pure presentational: a `<g>` of
 * stroked paths inside a 24×24 viewBox, sized by the `size` prop.
 *
 * Keyed by the BUNDLE's internal type keys (account, mcc, rate, commission,
 * category, …).  The engine emits ColumnDefinition strings that differ for
 * four of them (bank_account, merchant_category, exchange_rate,
 * bank_commission); `glyphKeyFor()` maps a definition → bundle glyph key so
 * callers can pass either.
 */

export type GlyphKey =
  | 'date'
  | 'amount'
  | 'description'
  | 'currency'
  | 'balance'
  | 'account'
  | 'status'
  | 'mcc'
  | 'category'
  | 'rate'
  | 'commission'
  | 'cashback'
  | 'time'
  | 'counterparty'
  | 'ignore';

/** Wraps a path set in the shared stroked-icon group (ICO() in the bundle). */
function ico(d: ReactNode): ReactNode {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d}
    </g>
  );
}

/** The 15 glyph path sets — ported verbatim from s3b-data.jsx :: TYPES. */
const GLYPHS: Record<GlyphKey, ReactNode> = {
  date: ico(
    <>
      <rect x="4" y="5" width="16" height="16" rx="1.5" />
      <path d="M4 9 H20 M8 3 V6 M16 3 V6" />
    </>,
  ),
  amount: ico(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8 V16 M9.5 9.5 H13 a2 2 0 0 1 0 4 H9.5 M9.5 12 H13.5" />
    </>,
  ),
  description: ico(<path d="M5 7 H19 M5 12 H19 M5 17 H13" />),
  currency: ico(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4 V20 M7 8 Q12 6 12 10 Q12 14 17 16" />
    </>,
  ),
  balance: ico(<path d="M12 4 V20 M5 9 H19 M7 9 L4.5 14 H9.5 Z M17 9 L14.5 14 H19.5 Z" />),
  account: ico(
    <>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <path d="M3 10 H21 M6 14 H10" />
    </>,
  ),
  status: ico(<path d="M6 3 V21 M6 4 H17 L14 8 L17 12 H6" />),
  mcc: ico(
    <>
      <path d="M4 4 H11 L20 13 L13 20 L4 11 Z" />
      <circle cx="8" cy="8" r="1.2" />
    </>,
  ),
  category: ico(
    <path d="M4 7 a2 2 0 0 1 2-2 H10 L12 7 H18 a2 2 0 0 1 2 2 V17 a2 2 0 0 1-2 2 H6 a2 2 0 0 1-2-2 Z" />,
  ),
  rate: ico(<path d="M4 8 H16 L13 5 M20 16 H8 L11 19" />),
  commission: ico(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 12 H16" />
    </>,
  ),
  cashback: ico(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8 V16 M8 12 H16" />
    </>,
  ),
  time: ico(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8 V12 L15 14" />
    </>,
  ),
  counterparty: ico(
    <>
      <rect x="5" y="4" width="14" height="17" />
      <path d="M9 8 H11 M13 8 H15 M9 12 H11 M13 12 H15 M9 16 H15" />
    </>,
  ),
  ignore: ico(
    <path d="M3 3 L21 21 M10.5 10.6 a2 2 0 0 0 2.9 2.8 M6.5 6.6 C4.6 7.9 3 12 3 12 s3 6 9 6 c1.4 0 2.6-.3 3.7-.8 M9.8 5.2 C10.5 5.1 11.2 5 12 5 c6 0 9 7 9 7 s-.8 1.6-2.2 3" />,
  ),
};

/**
 * Maps an engine ColumnDefinition string → bundle GlyphKey.
 *
 * Four definitions use snake_case where the bundle uses a short key:
 *   bank_account → account, merchant_category → mcc,
 *   exchange_rate → rate, bank_commission → commission.
 * The rest are 1:1.  Returns undefined for unknown / unmapped strings.
 */
export function glyphKeyFor(definition: string): GlyphKey | undefined {
  switch (definition) {
    case 'bank_account':
      return 'account';
    case 'merchant_category':
      return 'mcc';
    case 'exchange_rate':
      return 'rate';
    case 'bank_commission':
      return 'commission';
    default:
      return definition in GLYPHS ? (definition as GlyphKey) : undefined;
  }
}

export interface TypeGlyphProps {
  /** A bundle glyph key (e.g. 'account') OR an engine definition ('bank_account'). */
  name: string;
  size?: number;
}

/** Renders the SVG glyph for a column type. Renders an empty svg if the key is unknown. */
export function TypeGlyph({ name, size = 16 }: TypeGlyphProps) {
  const key = name in GLYPHS ? (name as GlyphKey) : glyphKeyFor(name);
  const glyph = key ? GLYPHS[key] : null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ display: 'block' }}
      aria-hidden="true"
      data-glyph={key ?? 'none'}
    >
      {glyph}
    </svg>
  );
}
