/**
 * ALTUS category icon set — geometry VERBATIM from design-reference/abc-iconset.jsx
 * (1.6px single-weight stroke, fill:none, 24×24). Icon-collection metadata (uk/en names,
 * group ids) included; the bundle's CURRENCIES/curOf/curName/BASE_ALIAS are deliberately
 * NOT ported — currency display wires through the engine at Story 1.6 (ENT-019).
 */
import type { ReactElement } from 'react';

const Gp = (d: ReactElement) => (
  <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d}</g>
);

export interface IconGroup {
  id: string;
  uk: string;
  en: string;
  items: Array<{ id: string; uk: string; en: string; g: ReactElement }>;
}

export const ICON_GROUPS: IconGroup[] = [
  { id: 'food', uk: 'Їжа', en: 'Food', items: [
    { id: 'groceries', uk: 'Продукти', en: 'Groceries', g: Gp(<><path d="M4 8 H20 L18.4 19 H5.6 Z"/><path d="M8 8 Q8 4 12 4 Q16 4 16 8"/><path d="M9.5 12 V16 M14.5 12 V16"/></>) },
    { id: 'dining', uk: 'Кафе і доставка', en: 'Dining', g: Gp(<><path d="M6 3 V9 M9 3 V9 M7.5 9 V21 M7.5 3 V9"/><path d="M16 3 C14 5 14 11 16 12 V21"/></>) },
    { id: 'coffee', uk: 'Кава', en: 'Coffee', g: Gp(<><path d="M5 9 H16 V13 A4 4 0 0 1 12 17 H9 A4 4 0 0 1 5 13 Z"/><path d="M16 10 H18 A2 2 0 0 1 18 14 H16"/><path d="M8 3 V6 M11.5 3 V6"/></>) },
    { id: 'bar', uk: 'Бар / алкоголь', en: 'Bar', g: Gp(<><path d="M5 5 H19 L12 13 Z"/><path d="M12 13 V19 M9 19 H15"/></>) },
    { id: 'sweets', uk: 'Солодощі', en: 'Sweets', g: Gp(<><ellipse cx="12" cy="12" rx="5" ry="3.5"/><path d="M7 12 L3 9.5 V14.5 Z"/><path d="M17 12 L21 9.5 V14.5 Z"/></>) },
  ]},
  { id: 'transport', uk: 'Транспорт', en: 'Transport', items: [
    { id: 'transport', uk: 'Авто', en: 'Car', g: Gp(<><path d="M3 13 L5 8 H15 L18 11 H21 V16 H3 Z"/><circle cx="7" cy="16" r="1.7"/><circle cx="17" cy="16" r="1.7"/></>) },
    { id: 'taxi', uk: 'Таксі', en: 'Taxi', g: Gp(<><path d="M5 16 L6.6 9.2 A2 2 0 0 1 8.5 7.7 H15.5 A2 2 0 0 1 17.4 9.2 L19 16 Z"/><rect x="3.5" y="16" width="17" height="2.6" rx="0.7"/><path d="M9 11 H15 M9.5 13.2 H13.5"/></>) },
    { id: 'transit', uk: 'Громадський', en: 'Transit', g: Gp(<><rect x="5" y="4.5" width="14" height="13.5" rx="2"/><path d="M5 11 H19"/><path d="M8 18 V20 M16 18 V20"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor"/><circle cx="15.5" cy="14.5" r="1" fill="currentColor"/></>) },
    { id: 'fuel', uk: 'Пальне', en: 'Fuel', g: Gp(<><path d="M5 20 V6 A2 2 0 0 1 7 4 H11 A2 2 0 0 1 13 6 V20"/><path d="M4 20 H14"/><path d="M7 9 H11"/><path d="M13 10 H16 V15 A1.5 1.5 0 0 0 19 15 V11 L17 8"/></>) },
    { id: 'parking', uk: 'Паркінг', en: 'Parking', g: Gp(<><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 17 V8 H13 A2.5 2.5 0 0 1 13 13 H9"/></>) },
    { id: 'flight', uk: 'Авіа', en: 'Flight', g: Gp(<><path d="M11 3 C13 3 13 8 13 10 L21 15 V17 L13 14 V18 L15 20 V21 L11 19.5 L7 21 V20 L9 18 V14 L1 17 V15 L9 10 C9 8 9 3 11 3 Z"/></>) },
  ]},
  { id: 'home', uk: 'Дім', en: 'Home', items: [
    { id: 'home', uk: 'Житло', en: 'Housing', g: Gp(<><path d="M4 11 L12 4 L20 11"/><path d="M6 10 V20 H18 V10"/><path d="M10 20 V14 H14 V20"/></>) },
    { id: 'utilities', uk: 'Комуналка', en: 'Utilities', g: Gp(<><path d="M13 3 L5 13 H11 L10 21 L19 10 H12 Z"/></>) },
    { id: 'internet', uk: 'Інтернет / звʼязок', en: 'Internet', g: Gp(<><path d="M5 9 A10 10 0 0 1 19 9"/><path d="M8 12 A6 6 0 0 1 16 12"/><circle cx="12" cy="16" r="1.4" fill="currentColor"/></>) },
    { id: 'furniture', uk: 'Меблі', en: 'Furniture', g: Gp(<><path d="M5 11 V9 A1.8 1.8 0 0 1 6.8 7.2 H17.2 A1.8 1.8 0 0 1 19 9 V11"/><path d="M4 11.5 A1.7 1.7 0 0 1 5.7 13.2 V16.5 H18.3 V13.2 A1.7 1.7 0 0 1 20 11.5"/><path d="M7.4 13.2 H16.6 M12 13.2 V16.5"/><path d="M6 16.5 V18.4 M18 16.5 V18.4"/></>) },
    { id: 'appliances', uk: 'Техніка', en: 'Appliances', g: Gp(<><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><circle cx="8" cy="6" r="0.8" fill="currentColor"/><path d="M14 6 H16"/></>) },
    { id: 'cleaning', uk: 'Прибирання', en: 'Cleaning', g: Gp(<><path d="M12 3 V12"/><path d="M9 12 L7.5 15 H16.5 L15 12 Z"/><path d="M7.5 15 L6.9 19 M9.5 15 L9.2 19.4 M12 15 V19.6 M14.5 15 L14.8 19.4 M16.5 15 L17.1 19"/></>) },
  ]},
  { id: 'health', uk: 'Здоровʼя', en: 'Health', items: [
    { id: 'health', uk: 'Здоровʼя', en: 'Health', g: Gp(<><path d="M12 4 L19 7 V12 C19 16 16 19 12 21 C8 19 5 16 5 12 V7 Z"/><path d="M12 9 V15 M9 12 H15"/></>) },
    { id: 'pharmacy', uk: 'Аптека', en: 'Pharmacy', g: Gp(<><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8 V16"/></>) },
    { id: 'dentist', uk: 'Стоматолог', en: 'Dentist', g: Gp(<><path d="M7 4 C4.5 4 4.5 8 5.5 12 C6.5 16 6 20 8 20 C9.2 20 9 16 12 16 C15 16 14.8 20 16 20 C18 20 17.5 16 18.5 12 C19.5 8 19.5 4 17 4 C14.5 4 14 6 12 6 C10 6 9.5 4 7 4 Z"/></>) },
    { id: 'sport', uk: 'Спорт', en: 'Sport', g: Gp(<><path d="M4 9 V15 M7 6.5 V17.5 M17 6.5 V17.5 M20 9 V15 M7 12 H17"/></>) },
    { id: 'beauty', uk: 'Краса', en: 'Beauty', g: Gp(<><rect x="8.5" y="10" width="6" height="11" rx="1"/><path d="M9.5 10 L10.5 4 L13 4 L13.5 10"/></>) },
    { id: 'haircut', uk: 'Перукар', en: 'Haircut', g: Gp(<><circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.6 L20 16 M8 15.4 L20 8"/></>) },
  ]},
  { id: 'personal', uk: 'Особисте', en: 'Personal', items: [
    { id: 'clothes', uk: 'Одяг', en: 'Clothes', g: Gp(<><path d="M8.5 4 L4 7 L6 10.5 L8 9.3 V20 H16 V9.3 L18 10.5 L20 7 L15.5 4 C15.5 6.5 8.5 6.5 8.5 4 Z"/></>) },
    { id: 'shoes', uk: 'Взуття', en: 'Shoes', g: Gp(<><path d="M3 18 H11.7 L17 14 H18 V18 H20 V14 C20 14 21 12 21 10 C21 8 20.5 6 20.5 6 H18.5 L18 7 L10 14 H8 L3 16 V18 Z"/></>) },
    { id: 'jewelry', uk: 'Прикраси', en: 'Jewelry', g: Gp(<><path d="M8 4 H16 L20 9 L12 20 L4 9 Z"/><path d="M4 9 H20 M8 4 L12 9 L16 4 M12 9 V20"/></>) },
    { id: 'shopping', uk: 'Покупки', en: 'Shopping', g: Gp(<><path d="M6 8 H18 L19 20 H5 Z"/><path d="M9 8 Q9 4 12 4 Q15 4 15 8"/></>) },
    { id: 'gadgets', uk: 'Гаджети', en: 'Gadgets', g: Gp(<><rect x="4" y="5" width="16" height="11" rx="1"/><path d="M2 19 H22 M9.5 16 H14.5"/></>) },
    { id: 'gifts', uk: 'Подарунки', en: 'Gifts', g: Gp(<><rect x="4" y="9" width="16" height="11"/><path d="M4 9 H20 M12 9 V20"/><path d="M12 9 C12 6 8 4 8 7 C8 9 12 9 12 9 C12 9 16 9 16 7 C16 4 12 6 12 9 Z"/></>) },
  ]},
  { id: 'leisure', uk: 'Дозвілля', en: 'Leisure', items: [
    { id: 'cinema', uk: 'Кіно', en: 'Cinema', g: Gp(<><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="7.25" r="1.05"/><circle cx="12" cy="16.75" r="1.05"/><circle cx="7.25" cy="12" r="1.05"/><circle cx="16.75" cy="12" r="1.05"/></>) },
    { id: 'games', uk: 'Ігри', en: 'Games', g: Gp(<><rect x="3.5" y="8" width="17" height="8" rx="4"/><path d="M8 10.3 V13.7 M6.3 12 H9.7"/><circle cx="16" cy="12" r="1.1" fill="currentColor"/></>) },
    { id: 'books', uk: 'Книги', en: 'Books', g: Gp(<><path d="M12 6.5 C9.5 5 6.5 5 4 5.6 V18 C6.5 17.4 9.5 17.4 12 19"/><path d="M12 6.5 C14.5 5 17.5 5 20 5.6 V18 C17.5 17.4 14.5 17.4 12 19"/><path d="M12 6.5 V19"/></>) },
    { id: 'music', uk: 'Музика', en: 'Music', g: Gp(<><path d="M9 18 V6 L19 4 V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></>) },
    { id: 'hobby', uk: 'Хобі', en: 'Hobby', g: Gp(<><path d="M12 3 C16.5 3 21 6.6 21 11 A5.4 5.4 0 0 1 15.6 16.4 C14 16.4 13.3 17.5 13.6 18.8 C13.8 20 13 21 12 21 A9 9 0 0 1 12 3 Z"/><circle cx="6.5" cy="11.5" r="1.3" fill="currentColor"/><circle cx="9.5" cy="7.5" r="1.3" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.3" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1.3" fill="currentColor"/></>) },
    { id: 'travel', uk: 'Подорожі', en: 'Travel', g: Gp(<><circle cx="12" cy="12" r="8"/><path d="M4 12 H20 M12 4 C8.5 7 8.5 17 12 20 C15.5 17 15.5 7 12 4"/></>) },
    { id: 'hotel', uk: 'Готель', en: 'Hotel', g: Gp(<><path d="M2.5 8 V18 M2.5 13 H21.5 V18"/><rect x="4.7" y="10" width="4.6" height="3" rx="1.3"/><path d="M2 18.2 H22 M4.5 18.2 V20 M19.5 18.2 V20"/></>) },
  ]},
  { id: 'edu', uk: 'Освіта і люди', en: 'Education & people', items: [
    { id: 'education', uk: 'Освіта', en: 'Education', g: Gp(<><path d="M12 4 L22 9 L12 14 L2 9 Z"/><path d="M6 11 V16 C6 18 18 18 18 16 V11"/></>) },
    { id: 'stationery', uk: 'Канцтовари', en: 'Stationery', g: Gp(<><path d="M5 19 L7 13 L17 3 L21 7 L11 17 Z"/><path d="M15 5 L19 9"/></>) },
    { id: 'kids', uk: 'Діти', en: 'Kids', g: Gp(<><path d="M4 6 H6 L8.5 13 H17 A6.5 6.5 0 0 0 8 7.5"/><circle cx="9.5" cy="18" r="1.6"/><circle cx="16" cy="18" r="1.6"/></>) },
    { id: 'pets', uk: 'Тварини', en: 'Pets', g: Gp(<><ellipse cx="6.5" cy="10" rx="1.4" ry="1.9"/><ellipse cx="10" cy="8" rx="1.4" ry="2"/><ellipse cx="14" cy="8" rx="1.4" ry="2"/><ellipse cx="17.5" cy="10" rx="1.4" ry="1.9"/><path d="M12 12 C9 12 7.3 14.5 7.9 17 C8.3 19 10 19.6 12 18.8 C14 19.6 15.7 19 16.1 17 C16.7 14.5 15 12 12 12 Z"/></>) },
    { id: 'family', uk: 'Сімʼя', en: 'Family', g: Gp(<><circle cx="8.5" cy="8" r="2.4"/><circle cx="16" cy="8.8" r="2"/><path d="M3.5 18.5 C3.5 13.8 13.5 13.8 13.5 18.5"/><path d="M14.3 13.6 C18 13.4 20.5 15.2 20.5 18"/></>) },
  ]},
  { id: 'finance', uk: 'Фінанси', en: 'Finance', items: [
    { id: 'subs', uk: 'Підписки', en: 'Subscriptions', g: Gp(<><path d="M19 9 A8 8 0 1 0 20 13.5"/><path d="M20 4 V9 H15"/></>) },
    { id: 'savings', uk: 'Заощадження', en: 'Savings', g: Gp(<><ellipse cx="12" cy="7" rx="6" ry="2.2"/><path d="M6 7 V16 A6 2.2 0 0 0 18 16 V7"/><path d="M6 10 A6 2.2 0 0 0 18 10"/><path d="M6 13 A6 2.2 0 0 0 18 13"/></>) },
    { id: 'invest', uk: 'Інвестиції', en: 'Investments', g: Gp(<><path d="M4 20 H20 M7 16 L11 12 L14 14 L19 8"/><path d="M19 8 H15 M19 8 V12"/></>) },
    { id: 'card', uk: 'Картка / кредит', en: 'Card / credit', g: Gp(<><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10 H21 M6 14 H10"/></>) },
    { id: 'insurance', uk: 'Страхування', en: 'Insurance', g: Gp(<><path d="M12 4 A8 7 0 0 1 20 11 H4 A8 7 0 0 1 12 4 Z"/><path d="M12 4 V2 M12 11 V18 A2.5 2.5 0 0 0 17 18"/></>) },
    { id: 'taxes', uk: 'Податки', en: 'Taxes', g: Gp(<><path d="M6 3 H14 L18 7 V21 H6 Z"/><path d="M14 3 V7 H18"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="17" r="1"/><path d="M14.5 12.5 L9.5 17.5"/></>) },
    { id: 'fees', uk: 'Комісії', en: 'Fees', g: Gp(<><circle cx="12" cy="12" r="8"/><circle cx="9.5" cy="9.5" r="1.3"/><circle cx="14.5" cy="14.5" r="1.3"/><path d="M15 9 L9 15"/></>) },
    { id: 'charity', uk: 'Благодійність', en: 'Charity', g: Gp(<><path d="M4 14 V20 H7 L12 21 C16 21 20 18 20 15.5 C20 13.5 18 13.5 16 14.5 L12.5 15.5"/><path d="M9 9 C9 6.5 12.5 6.5 12.5 9 C12.5 6.5 16 6.5 16 9 C16 12 12.5 13 12.5 13 C12.5 13 9 12 9 9 Z"/></>) },
    { id: 'work', uk: 'Робота', en: 'Work', g: Gp(<><rect x="3" y="7" width="18" height="12" rx="1.5"/><path d="M8 7 V5 A1.5 1.5 0 0 1 9.5 3.5 H14.5 A1.5 1.5 0 0 1 16 5 V7"/><path d="M3 12 H21"/></>) },
    { id: 'income', uk: 'Дохід', en: 'Income', g: Gp(<><path d="M4 8 H18 A2 2 0 0 1 20 10 V17 A2 2 0 0 1 18 19 H4 Z"/><path d="M4 8 V6 A1 1 0 0 1 5 5 H16"/><circle cx="16" cy="13.5" r="1.6"/></>) },
    { id: 'other', uk: 'Інше', en: 'Other', g: Gp(<><path d="M12 3 L21 12 L12 21 L3 12 Z"/><path d="M12 8 L16 12 L12 16 L8 12 Z" strokeWidth="1.3"/></>) },
  ]},
];

export const ICONS: Record<string, ReactElement> = {};
export const ICON_META: Record<string, { uk: string; en: string; group: string }> = {};
export const ICON_ORDER: string[] = [];
ICON_GROUPS.forEach((grp) =>
  grp.items.forEach((it) => {
    ICONS[it.id] = it.g;
    ICON_META[it.id] = { uk: it.uk, en: it.en, group: grp.id };
    ICON_ORDER.push(it.id);
  }),
);

export function iconName(id: string, lang: 'uk' | 'en'): string {
  const meta = ICON_META[id];
  return meta ? meta[lang] : id;
}

export function CatIcon({ id, size = 22, color = 'var(--ebony)' }: { id: string; size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ color, display: 'block' }}>
      {ICONS[id] ?? ICONS['other']}
    </svg>
  );
}
