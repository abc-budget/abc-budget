/** Chrome strings — uk (SOURCE OF TRUTH for the key set). User content NEVER enters catalogs. */
export const CATALOG_UK = {
  // zones + brand
  zoneDashboard: 'Дашборд',
  zoneSettings: 'Налаштування',
  // stepper
  stepFile: 'ФАЙЛ',
  stepColumns: 'КОЛОНКИ',
  stepCategories: 'КАТЕГОРІЇ',
  stepReview: 'ОГЛЯД',
  stepOfTotal: 'КРОК {n} / {total}',
  // onboarding
  obTitle: 'Ласкаво просимо',
  obLead: 'Перший запуск. Імпортуйте виписку, щоб почати.',
  ctaImportStatement: 'Імпортувати виписку',
  ctaTryExample: 'Спробувати на прикладі',
  // dashboard
  dashTitle: 'Дашборд',
  dashLead: "Бюджет з'явиться тут (EP-6). Поки що — імпортуйте виписку.",
  ctaImport: 'Імпорт виписки',
  // settings
  setTabOverview: 'Огляд',
  setTabCategories: 'Категорії',
  setDataTitle: 'Дані',
  setDataLead: 'Базова валюта, мова, поріг — у наступних сторіз.',
  setCatTitle: 'Категорії',
  setCatLead: 'Керування категоріями — EP-5.',
  // import wizard
  impSourceTitle: 'Джерело',
  impSourceNote: 'Завантаження файлу — EP-2.1 (the wedge).',
  impColumnsTitle: 'Колонки',
  impColumnsNote: 'Мапінг колонок + UNKNOWN-gate — EP-2.',
  impCategoriesTitle: 'Категоризація',
  impCategoriesNote: 'Правила, RUL/, LOG/ — EP-4.',
  impReviewTitle: 'Огляд і збереження',
  impReviewNote: 'Збереження footprint — EP-3.',
  keyBack: 'Назад',
  keyNext: 'Далі',
  keyImportMore: 'Імпортувати ще',
  keyToBudget: 'До бюджету',
} as const;

export type ChromeKey = keyof typeof CATALOG_UK;
