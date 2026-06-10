export type LampTone = 'green' | 'gold' | 'orange' | 'gray' | 'off';

/**
 * Jeweled indicator (.lamp). Decorative: aria-hidden — §4 requires pairing it with a
 * visible word; the lamp alone never carries state.
 */
export function Lamp({ tone }: { tone: LampTone }) {
  return <span className={`lamp ${tone}`} aria-hidden="true" />;
}
