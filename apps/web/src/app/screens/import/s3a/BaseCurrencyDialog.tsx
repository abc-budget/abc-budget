import { useMemo, useState } from 'react';
import { localeToCurrency } from '@abc-budget/engine';
import { Key, Lamp } from '../../../../ui/altus/components';
import { useEngineClient } from '../../../engine-client-context';
import { useLang, useT } from '../../../i18n/LangProvider';
import './s3a.css';

/**
 * Cold-start base-currency dialog (Story 2.7 Task 4, ENT-019; decision 3).
 * Visual port of design-reference/s3a-app.jsx BaseCurrencyDialog — modal scrim,
 * two screws, green-lamp header, body, labeled native select, autonote,
 * cancel/continue keys.
 *
 * The list (decision 3): TWO optgroups — the prototype's curated 8 in
 * prototype order on top, then the FULL reference minus those 8, sorted.
 * The engine's 1.6 currency reference is internal (the public runtime surface
 * is exactly the two client factories + localeToCurrency — boundary
 * exactness), so localized names come from the platform's own ISO-4217
 * dataset: Intl.DisplayNames(lang, {type:'currency'}) for BOTH groups (never
 * hardcoded), and the full ISO list from Intl.supportedValuesOf('currency').
 * Symbols: the prototype's small curated map for the 8; the lower group is
 * ISO-only (S4's searchable picker owns anything richer).
 *
 * Preselect = localeToCurrency(navigator.language) ?? 'USD' ('USD' also when
 * the mapped code is unknown to the rendered list — a select value without an
 * option would render as a silent mismatch).
 *
 * Confirm → client.setBaseCurrency(iso) → onDone. A rejection (e.g.
 * InvalidBaseCurrencyError off the wire) stays IN the dialog as a loud inline
 * error line (HC-7) — never a silent close. Cancel → onCancel (the caller
 * navigates to '/' — Onboarding pre-data).
 */

/** Prototype symbol map for the curated 8 (s3a-app.jsx S3_CUR, same order). */
const CURATED: ReadonlyArray<{ iso: string; sym: string }> = [
  { iso: 'UAH', sym: '₴' },
  { iso: 'USD', sym: '$' },
  { iso: 'EUR', sym: '€' },
  { iso: 'GBP', sym: '£' },
  { iso: 'PLN', sym: 'zł' },
  { iso: 'CHF', sym: '₣' },
  { iso: 'CZK', sym: 'Kč' },
  { iso: 'GEL', sym: '₾' },
];
const CURATED_ISO = new Set(CURATED.map((c) => c.iso));

export interface BaseCurrencyDialogProps {
  /** The currency persisted successfully — close the gate, S3a proceeds. */
  onDone: () => void;
  /** First run declined — the caller leaves /import (navigate('/')). */
  onCancel: () => void;
}

export function BaseCurrencyDialog({ onDone, onCancel }: BaseCurrencyDialogProps) {
  const t = useT();
  const { lang } = useLang();
  const client = useEngineClient();

  /** Full reference minus the curated 8, sorted (supportedValuesOf is already
   *  alphabetical; the sort pins determinism rather than trusting it). */
  const rest = useMemo(
    () => Intl.supportedValuesOf('currency').filter((iso) => !CURATED_ISO.has(iso)).sort(),
    [],
  );

  const names = useMemo(
    () => new Intl.DisplayNames([lang], { type: 'currency', fallback: 'code' }),
    [lang],
  );
  const nameOf = (iso: string): string => names.of(iso) ?? iso;

  const [iso, setIso] = useState<string>(() => {
    const detected = localeToCurrency(navigator.language) ?? 'USD';
    return CURATED_ISO.has(detected) || rest.includes(detected) ? detected : 'USD';
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const confirm = () => {
    setSaving(true);
    setSaveError(null);
    client.setBaseCurrency(iso).then(onDone, (err: unknown) => {
      // LOUD inline (HC-7): the dialog stays open, the failure is visible.
      setSaving(false);
      setSaveError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div
      className="modal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={t('s3aBaseTitle')}
      data-testid="s3a-basecur"
      onClick={onCancel}
    >
      <div className="modal basecur-modal" onClick={(e) => e.stopPropagation()}>
        <span className="screw" aria-hidden="true" style={{ top: 12, left: 12 }} />
        <span className="screw" aria-hidden="true" style={{ top: 12, right: 12 }} />
        <div className="modal-h">
          <Lamp tone="green" />
          <span className="f-disp modal-title">{t('s3aBaseTitle')}</span>
        </div>
        <p className="body-p modal-body">{t('s3aBaseBody')}</p>
        <label className="bc-field">
          <span className="field-lab f-mono">{t('s3aBaseLabel')}</span>
          <div className="cream bc-select">
            <select
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              data-testid="s3a-basecur-select"
            >
              <optgroup label={t('s3aBaseGroupCurated')}>
                {CURATED.map((c) => (
                  <option key={c.iso} value={c.iso}>{`${c.sym}  ${c.iso} · ${nameOf(c.iso)}`}</option>
                ))}
              </optgroup>
              <optgroup label={t('s3aBaseGroupAll')}>
                {rest.map((code) => (
                  <option key={code} value={code}>{`${code} · ${nameOf(code)}`}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </label>
        <div className="bc-autonote f-mono">▸ {t('s3aBaseAuto')}</div>
        {saveError !== null && (
          <div className="bc-error f-mono" role="alert" data-testid="s3a-basecur-error">
            ✕ {t('s3aBaseError')} — {saveError}
          </div>
        )}
        <div className="modal-actions">
          <Key variant="beige" sm onClick={onCancel}>
            {t('s3aCancel')}
          </Key>
          <Key variant="green" sm disabled={saving} aria-disabled={saving} onClick={confirm}>
            {t('s3aCont')}
          </Key>
        </div>
      </div>
    </div>
  );
}
