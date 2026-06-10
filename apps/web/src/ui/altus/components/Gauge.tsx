import type { BadgeState } from './StateBadge';

const N = 28;

/**
 * Lit-cell + % colours per state (token-derived, mirrors prototype STATE_META).
 * The two literals are VERBATIM from dashboard-data.jsx STATE_META — no ALTUS token
 * exists for them (`--gold-deep` is a different shade than the almost-% `#7a5c00`;
 * the history half-gold has no token). Not a "tokens only" violation: traceability wins.
 */
const GAUGE_COLOR: Record<BadgeState, { cell: string; deep: string }> = {
  within: { cell: 'var(--green)', deep: 'var(--green-deep)' },
  almost: { cell: 'var(--gold)', deep: '#7a5c00' },
  over: { cell: 'var(--orange)', deep: 'var(--orange-deep)' },
  muted: { cell: 'var(--gray-warm)', deep: 'var(--gray-warm)' },
  history: { cell: 'rgba(225,173,1,.5)', deep: 'var(--gray-warm)' },
};

export interface GaugeProps {
  spent: number;
  budget: number;
  state: BadgeState;
  archived?: boolean;
  /** i18n-agnostic: the «over limit» word(s) come from the caller (1.4). */
  overLimitLabel?: string;
}

/** Dot-matrix budget gauge — the console "lit pixels" readout. */
export function Gauge({ spent, budget, state, archived, overLimitLabel = '' }: GaugeProps) {
  const ratio = budget > 0 ? spent / budget : 0;
  const litCount = Math.min(N, Math.round(Math.min(ratio, 1) * N));
  const { cell, deep } = GAUGE_COLOR[state];
  const pct = budget > 0 ? Math.round(ratio * 100) : 0;
  return (
    <div className="gauge-wrap">
      <div className="gauge">
        {Array.from({ length: N }, (_, i) => {
          const on = i < litCount && !archived;
          return (
            <span
              key={i}
              className="cell"
              style={on ? { background: cell, boxShadow: `0 0 5px ${cell}, inset 0 0 1px rgba(255,255,255,.4)` } : undefined}
            />
          );
        })}
      </div>
      <div className="gauge-foot">
        <span className="f-mono pctnum" style={{ color: archived ? 'var(--gray-warm)' : deep }}>
          {archived ? '—' : `${pct}%`}
        </span>
        {ratio > 1 && !archived && (
          <span className="f-mono ovr-pct">{`+${Math.round((ratio - 1) * 100)}% ${overLimitLabel}`}</span>
        )}
      </div>
    </div>
  );
}
