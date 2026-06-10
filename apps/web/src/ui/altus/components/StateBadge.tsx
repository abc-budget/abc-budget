import type { ReactElement } from 'react';

export const BADGE_STATES = ['within', 'almost', 'over', 'muted', 'history'] as const;
export type BadgeState = (typeof BADGE_STATES)[number];

const BADGE_CLS: Record<BadgeState, string> = {
  within: 'within', almost: 'almost', over: 'over', muted: 'muted', history: 'muted',
};

/* Geometry copied verbatim from design-reference/dashboard-app.jsx lines 48–54 */
const BADGE_ICON: Record<BadgeState, ReactElement> = {
  within:  (<path d="M4 12 L10 18 L20 6" />),
  almost:  (<g><path d="M12 3 L22 20 H2 Z" /><path d="M12 10 V14" strokeWidth="2" /><circle cx="12" cy="17.3" r="1" fill="currentColor" stroke="none" /></g>),
  over:    (<g><circle cx="12" cy="12" r="9" /><path d="M12 6 V13" strokeWidth="2" /><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" /></g>),
  muted:   (<g><rect x="3" y="4" width="18" height="4" /><rect x="5" y="8" width="14" height="13" /><path d="M10 13 H14" /></g>),
  history: (<g><circle cx="12" cy="12" r="9" /><path d="M12 7 V12 L16 14" /></g>),
};

export interface StateBadgeProps {
  state: BadgeState;
  /** Visible state word (i18n arrives in 1.4 — the library is translation-agnostic). */
  label: string;
  extra?: string;
}

/** §4: state is never colour alone — icon + label are part of the state definition. */
export function StateBadge({ state, label, extra }: StateBadgeProps) {
  return (
    <span className={`badge ${BADGE_CLS[state]}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {BADGE_ICON[state]}
      </svg>
      {label}
      {extra ? ` · ${extra}` : ''}
    </span>
  );
}
