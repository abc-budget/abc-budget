/**
 * CategoryPicker — searchable category list with an inline "create from search"
 * affordance.  Bound to CategoryDTO[].  `onPick(categoryId)` / `onCreate(name)`.
 *
 * When the search yields nothing, the only row is "create «{query}»"; otherwise
 * a trailing "create category" row is always offered.
 */
import { useState } from 'react';
import { CatIcon } from '../../../../ui/altus/icons';
import { SearchIcon } from './icons';
import { useT } from '../../../i18n/LangProvider';
import type { CategoryDTO } from '@abc-budget/engine';
import './s3c.css';

export interface CategoryPickerProps {
  categories: CategoryDTO[];
  currentId: string | null;
  onPick: (categoryId: string) => void;
  onCreate: (name: string) => void;
  lang: 'uk' | 'en';
}

export function CategoryPicker({ categories, currentId, onPick, onCreate, lang: _lang }: CategoryPickerProps) {
  const t = useT();
  const [q, setQ] = useState('');
  const query = q.trim();
  const list = categories.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="catpicker">
      <div className="cream catpicker-search">
        <SearchIcon size={14} />
        <input autoFocus value={q} placeholder={t('s3cPickSearch')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="catpicker-list">
        {list.map((c) => (
          <button
            type="button"
            key={c.id}
            className={`catpicker-item${currentId === c.id ? ' on' : ''}`}
            onClick={() => onPick(c.id)}
          >
            <CatIcon id={c.icon} size={17} color="var(--ebony)" />
            <span className="f-disp">{c.name}</span>
            {currentId === c.id && <span className="cpi-check" aria-hidden="true">✓</span>}
          </button>
        ))}

        {list.length === 0 && query && (
          <button type="button" className="catpicker-item catpicker-create" onClick={() => onCreate(query)}>
            <span className="cpc-plus" aria-hidden="true">＋</span>
            <span className="f-disp">{t('s3cCreateNamed', { q: query })}</span>
          </button>
        )}
        {list.length === 0 && !query && (
          <div className="catpicker-empty f-mono">— {t('s3cPickNone')} —</div>
        )}
        {(list.length > 0 || !query) && (
          <button type="button" className="catpicker-item catpicker-create" onClick={() => onCreate('')}>
            <span className="cpc-plus" aria-hidden="true">＋</span>
            <span className="f-disp">{t('s3cCreateCat')}</span>
          </button>
        )}
      </div>
    </div>
  );
}
