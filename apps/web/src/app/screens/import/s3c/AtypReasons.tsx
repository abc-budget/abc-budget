import { useT } from '../../../i18n/LangProvider';
import { mccTitle } from '../../../mcc/mcc-lookup';
import type { TypicalityReasonDTO, TypicalityReasonKind } from '@abc-budget/engine';

export interface AtypReasonsProps {
  reasons: TypicalityReasonDTO[];
  lang: 'uk' | 'en';
}

export function AtypReasons({ reasons, lang }: AtypReasonsProps) {
  const t = useT();
  // Exhaustive over TypicalityReasonKind — a NEW 4.8 kind fails tsc here until a renderer exists.
  const renderChip: Record<TypicalityReasonKind, (r: TypicalityReasonDTO) => [string, string]> = {
    'categorical-minority': (r) =>
      r.field === 'mcc'
        ? [t('s3cRsnMccTitle'), mccTitle(typeof r.value === 'number' ? r.value : Number(r.value), lang)]
        : [`${String(r.value ?? '')} ${t('s3cRsnCat')}`, ''],
    'amount-outlier': (r) => [t('s3cRsnAmt'), `×${r.magnitude ?? '?'}`],
    'rare-tokens': (r) => [t('s3cRsnTxt'), `«${(r.tokens ?? []).join(', ')}»`],
  };
  return (
    <span className="atyp-reasons">
      {reasons.map((r, i) => {
        const [k, v] = renderChip[r.kind](r);
        return (
          <span className="atyp-rsn" key={i}>
            <span className="k">{k}</span>{v ? <> · {v}</> : null}
          </span>
        );
      })}
    </span>
  );
}
