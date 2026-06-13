import { useT } from '../../../i18n/LangProvider';
import { Key } from '../../../../ui/altus/components';
import './s3b.css';

export interface CollisionBannerProps {
  /** The raw name of the column whose saved rule differs. */
  columnName: string;
  /** Confirm → update the saved rule (LWW at flush). */
  onConfirm: () => void;
  /** Decline → keep the stored rule (no-clobber default at flush). */
  onDecline: () => void;
}

/**
 * CollisionBanner — the LOUD, persistent save-collision affordance (decision #5
 * + item 3).
 *
 * Renders when the snapshot's lastSaveCollision is set: a recalled column's
 * saved rule params differ from the just-applied/confirmed ones.  It is loud
 * (its own .collbanner block, role="alert", a gold lamp) and PERSISTENT — it
 * stays until the user resolves it (confirm = update the rule / decline = keep
 * the stored one).  It does NOT block the gate: the column is typed, so it
 * passes canAdvance() #2; this is a propose-don't-force surface (VIS-009).
 *
 * Pure: props in, onConfirm/onDecline out.
 */
export function CollisionBanner({ columnName, onConfirm, onDecline }: CollisionBannerProps) {
  const t = useT();
  return (
    <div className="collbanner" role="alert" data-testid="collision-banner">
      <div className="collbanner-head f-mono">
        <span className="collbanner-lamp" aria-hidden="true" />
        {t('s3bCollTag')}
      </div>
      <p className="collbanner-body">{t('s3bCollBody', { col: columnName })}</p>
      <div className="collbanner-actions">
        <Key variant="gold" sm onClick={onConfirm}>
          {t('s3bCollConfirm')}
        </Key>
        <Key variant="beige" sm onClick={onDecline}>
          {t('s3bCollDecline')}
        </Key>
      </div>
    </div>
  );
}
