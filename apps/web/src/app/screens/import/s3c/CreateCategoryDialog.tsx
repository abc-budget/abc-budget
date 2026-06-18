/**
 * CreateCategoryDialog — modal to create a category: name + currency (with the
 * «base» follow note) + an IconPicker (a grouped/searchable glyph grid sourced
 * from ui/altus/icons ICON_GROUPS).  `onCreate({ name, icon, currency })`.
 *
 * Presentational: owns only its own form state; the screen persists the result.
 */
import { useState } from 'react';
import { ICON_GROUPS, CatIcon, iconName } from '../../../../ui/altus/icons';
import { SearchIcon, CheckIcon } from './icons';
import { Key } from '../../../../ui/altus/components/Key';
import { Chip } from '../../../../ui/altus/components/Chip';
import { useT } from '../../../i18n/LangProvider';
import './s3c.css';

export interface CreateCategoryDialogProps {
  initialName: string;
  onCreate: (data: { name: string; icon: string; currency: string }) => void;
  onCancel: () => void;
  lang: 'uk' | 'en';
}

// 'base' is the engine's BASE_CURRENCY_ALIAS (4.3a, categories-service.ts) — it
// MUST be lowercase; 'BASE' throws InvalidCategoryError: Invalid currency.
const CURRENCY_OPTIONS = [
  { iso: 'base', label: '₴ base' },
  { iso: 'UAH', label: '₴ UAH' },
  { iso: 'USD', label: '$ USD' },
  { iso: 'EUR', label: '€ EUR' },
  { iso: 'GBP', label: '£ GBP' },
];

function IconPicker({ value, onPick, lang }: { value: string; onPick: (id: string) => void; lang: 'uk' | 'en' }) {
  const t = useT();
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const groups = ICON_GROUPS.map((grp) => ({
    grp,
    items: grp.items.filter((it) => !s || it.id.includes(s) || it.uk.toLowerCase().includes(s) || it.en.toLowerCase().includes(s)),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="iconpick">
      <div className="cream catpicker-search iconpick-search">
        <SearchIcon size={14} />
        <input value={q} placeholder={t('s3cIconSearchPh')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="iconpick-scroll">
        {groups.map(({ grp, items }) => (
          <div key={grp.id} className="iconpick-group">
            <div className="iconpick-glab f-mono">▸ {grp[lang]}</div>
            <div className="icon-grid">
              {items.map((it) => (
                <button
                  type="button"
                  key={it.id}
                  className={`icon-cell${value === it.id ? ' on' : ''}`}
                  title={iconName(it.id, lang)}
                  aria-label={iconName(it.id, lang)}
                  aria-pressed={value === it.id}
                  onClick={() => onPick(it.id)}
                >
                  <CatIcon id={it.id} size={22} color="var(--ebony)" />
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="catpicker-empty f-mono">— {t('s3cIconNone')} —</div>}
      </div>
    </div>
  );
}

export function CreateCategoryDialog({ initialName, onCreate, onCancel, lang }: CreateCategoryDialogProps) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState('groceries');
  const [currency, setCurrency] = useState('base');
  const canSave = name.trim().length > 0;

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="create-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <span className="screw" aria-hidden="true" style={{ top: 12, left: 12 }} />
        <span className="screw" aria-hidden="true" style={{ top: 12, right: 12 }} />
        <div className="modal-h">
          <span className="logchip">NEW/</span>
          <span className="f-disp modal-title">{t('s3cNewCatTitle')}</span>
          <Chip onClick={onCancel} style={{ marginLeft: 'auto' }}>
            ✕
          </Chip>
        </div>

        <div className="create-grid">
          <div className="create-preview">
            <CatIcon id={icon} size={36} color="var(--ebony)" />
          </div>
          <div className="create-fields">
            <label className="field">
              <span className="field-lab f-mono">{t('s3cFName')}</span>
              <div className="cream field-input">
                <input autoFocus value={name} placeholder={t('s3cFNamePh')} onChange={(e) => setName(e.target.value)} />
              </div>
            </label>
            <label className="field">
              <span className="field-lab f-mono">{t('s3cFCur')}</span>
              <div className="cream field-input cc-sel">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label={t('s3cFCur')}>
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.iso} value={c.iso}>
                      {c.iso === 'base' ? `${c.label} · ${t('s3cBaseAlias')}` : c.label}
                    </option>
                  ))}
                </select>
              </div>
              {currency === 'base' && <div className="cur-locked-note f-mono">▸ {t('s3cFollowBaseNote')}</div>}
            </label>
          </div>
        </div>

        <IconPicker value={icon} onPick={setIcon} lang={lang} />

        <div className="modal-actions">
          <button type="button" className="key beige sm" onClick={onCancel}>
            {t('s3cCancel')}
          </button>
          <Key
            variant="green"
            sm
            disabled={!canSave}
            icon={<CheckIcon size={16} />}
            onClick={() => onCreate({ name: name.trim(), icon, currency })}
          >
            {t('s3cCreate')}
          </Key>
        </div>
      </div>
    </div>
  );
}
