/**
 * Ring — the gold hollow-ring atypicality marker (geometry verbatim from
 * design-reference/s3c-app.jsx :: Ring).  A hint, not an alarm lamp.
 *
 * Built now because it is shared/cheap; the atypicality surfacing that USES it
 * is Story 4.9c (the CategoryCell `atypical` seam).  Decorative → aria-hidden.
 */
export function Ring({ size = 13 }: { size?: number }) {
  return (
    <svg className="atyp-ring" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="var(--gold-deep)" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="1.5" fill="var(--gold)" />
    </svg>
  );
}
