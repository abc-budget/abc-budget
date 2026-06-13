/** Chrome strings — uk (SOURCE OF TRUTH for the key set). User content NEVER enters catalogs. */
export const CATALOG_UK = {
  // zones + brand
  langToggleLabel: 'Мова інтерфейсу',
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
  // engine status banner (2.6 — the three loud states; full matrix is 2.7/2.8)
  engBlockedTitle: 'Сховище заблоковано',
  engBlockedBody: 'Закрийте інші вкладки ABC Budget і перезавантажте сторінку.',
  engMismatchTitle: 'Потрібне оновлення',
  engMismatchBody: 'Версії застосунку розійшлися. Перезавантажте, щоб оновитися.',
  engMismatchReload: 'Перезавантажити',
  engDiedTitle: 'Обробник перезапускається',
  engDiedBody: 'Фоновий обробник зупинився — поточну операцію перервано. Його буде перезапущено автоматично.',
  // ── S3a — Import → Source (2.7; ported from design-reference/s3a-i18n.jsx) ──
  s3aEyebrow: '▸ ІМПОРТ · ДЖЕРЕЛО',
  s3aStepOf: 'КРОК 1 / 4',
  s3aTitle: 'Оберіть файл виписки',
  s3aLead: 'Візьміть виписку, яку ви експортували з банку. ABC прочитає її тут, на цьому пристрої — нічого не вивантажується в інтернет.',
  // drop zone
  s3aDropTitle: 'Перетягніть файл сюди',
  s3aDropOr: 'або',
  s3aPick: 'Обрати файл',
  s3aFormats: 'CSV · XLS · XLSX · до 50 МБ',
  s3aLocalOnly: 'ЛОКАЛЬНО · ФАЙЛ НЕ ПОКИДАЄ ПРИСТРІЙ',
  s3aSample: 'Спробувати на прикладі',
  // file chip
  s3aReplace: 'Замінити',
  s3aRemove: 'Прибрати',
  s3aRowsEst: 'рядків (приблизно)',
  // recognized (per-column recall from the learned pool — NOT a "format")
  // prototype recogTitle(n,m) is conditional → two parameterized keys; the component picks on n===m
  s3aRecogTag: '▸ РОЗПІЗНАНО З ВАШИХ ПРАВИЛ',
  s3aRecogTitleAll: 'Усі {m} колонок розпізнано',
  s3aRecogTitleSome: 'Розпізнано {n} з {m} колонок',
  s3aRecogBody: 'Назви цих колонок збігаються з тими, які ви вже зіставляли раніше, тож ABC підставив їхні типи з ваших збережених правил. Це точний збіг назв — не здогад і не ШІ.',
  s3aRecogPartial: '{k} ще без типу — зіставите їх на наступному кроці.',
  s3aPoolLab: 'КОЛОНКИ ФАЙЛУ → ВАШІ ПРАВИЛА',
  s3aRecalled: 'з правил',
  s3aUnkType: 'без типу',
  s3aDedupTitle: 'Повторні операції не рахуються двічі',
  s3aDedupBody: 'Якщо у файлі є операції, які ви вже імпортували раніше, ABC їх розпізнає й об’єднає. Точні числа — на кроці «Огляд».',
  s3aProceedNote: 'Кожен імпорт проходить перевірку. Повний розбір запуститься, коли натиснете «Продовжити».',
  s3aReviewMap: 'Переглянути зіставлення',
  s3aProceed: 'Продовжити ▸',
  // unknown = empty pool (first-ever import) → all columns untyped
  s3aUnkTag: '▸ ЖОДНОЇ ВІДОМОЇ КОЛОНКИ',
  s3aUnkTitle: 'Перший імпорт — правил ще немає',
  s3aUnkBody: 'ABC ще не бачив цих назв колонок, тож усі вони поки без типу. На наступному кроці ви зіставите їх вручну, і ABC запам’ятає назви — наступного разу він підставить типи автоматично.',
  s3aUnkAllCols: '{m} колонок · усі без типу',
  s3aNextUnk: 'Далі · зіставити колонки ▸',
  // error (fail loud, HC-7). The *V values are DEFAULTS for the generic
  // read-failure case — the real ErrorPanel renders decode-issue-driven props;
  // the container falls back to these when no specific issue copy exists.
  s3aErrTag: '▸ НЕ ВДАЛОСЯ ПРОЧИТАТИ ФАЙЛ',
  s3aErrWhat: 'ЩО:',
  s3aErrWhy: 'ЧОМУ:',
  s3aErrDo: 'ДІЯ:',
  s3aErrWhatV: 'Файл не вдалося відкрити',
  s3aErrWhyV: 'Він порожній, пошкоджений або це не таблиця (CSV/XLS/XLSX).',
  s3aErrDoV: 'Перевірте, що це експорт виписки, і спробуйте інший файл.',
  // issue-specific ЧОМУ (2.7 Task 3 — derived from the FATAL DecodeIssue kind)
  s3aErrWhyNoData: 'У файлі не знайшлося жодного рядка з даними.',
  s3aErrWhyUnreadable: 'Вміст не вдалося розібрати — файл пошкоджений або це не CSV/XLS/XLSX.',
  s3aTryAgain: 'Обрати інший файл',
  s3aBack: 'Назад',
  // decoding (DecodingPanel — NO bundle equivalent; dev-designed copy, PM pixel pass)
  s3aDecodingTag: '▸ ЧИТАННЯ ФАЙЛУ',
  s3aDecodingPrep: 'ВІДКРИВАЄМО ФАЙЛ…',
  s3aDecodingRows: '{done} / {total} рядків',
  // base-currency cold-start dialog (Task 4 consumes; keys ported with the bundle set)
  s3aBaseTitle: 'Базова валюта',
  s3aBaseBody: 'Загальні підсумки бюджету рахуються в одній валюті. Ми визначили її автоматично — перевірте перед першим імпортом.',
  s3aBaseLabel: 'Валюта',
  s3aBaseAuto: 'ВИЗНАЧЕНО ЗА РЕГІОНОМ · ПОТІМ МОЖНА ЗМІНИТИ В НАЛАШТУВАННЯХ',
  s3aCancel: 'Скасувати',
  s3aCont: 'Далі ▸',
  // dialog optgroup labels + the loud save-failure line (Task 4) — NO bundle
  // source (the prototype select had only the curated 8): dev-designed copy,
  // PM eyeballs at the pixel pass.
  s3aBaseGroupCurated: 'Поширені',
  s3aBaseGroupAll: 'Усі валюти',
  s3aBaseError: 'Не вдалося зберегти валюту',
  // multi-sheet neutral note (2.1 decision — flagged, not invented)
  s3aOtherSheets: 'У файлі є інші аркуші: {names} — прочитано лише перший.',
  // useBlocker exit-protection (1.5 carry-forward, lands at 2.7 Task 3)
  s3aLeaveTitle: 'Перервати імпорт?',
  s3aLeaveBody: 'Якщо ви підете зараз, поточний імпорт буде скасовано. Файл доведеться завантажити знову.',
  s3aLeaveStay: 'Залишитись',
  s3aLeaveLeave: 'Перервати й вийти',
  // ── S3b — Import → Columns (2.8; ported from design-reference/s3b-data.jsx `M`) ──
  s3bEyebrow: '▸ ІМПОРТ · КОЛОНКИ',
  s3bStepOf: 'КРОК 2 / 4',
  s3bTitle: 'Зіставте колонки',
  s3bLead: 'ABC підставив типи колонок, які ви вже зіставляли раніше (з ваших правил) — підтвердьте або виправте. Це точний збіг назв, не ШІ.',
  // raw statement header
  s3bRaw: 'СИРА ВИПИСКА',
  s3bTransient: 'ТИМЧАСОВИЙ ПЕРЕГЛЯД · НЕ ЗБЕРІГАЄТЬСЯ',
  s3bRows: 'рядків',
  s3bCols: 'колонок',
  // column states
  s3bUnknown: 'не визначено',
  s3bUnknownShort: 'без типу',
  s3bGuessed: 'з правил',
  s3bGuessedN: 'з правил',
  s3bConfirmed: 'підтв.',
  s3bIgnored: 'ігнор.',
  // status panel
  s3bStatusTitle: 'СТАН ЗІСТАВЛЕННЯ',
  s3bRecallNote: '«З правил» = ABC підставив тип за точним збігом назви колонки з вашими збереженими правилами. Це детермінований відклик, не ШІ. Перший імпорт (правил ще немає) → усі колонки без типу.',
  // normalization panel
  s3bNormTitle: 'НОРМАЛІЗАЦІЯ ВАЛЮТИ',
  s3bNormSub: 'символ · код → ISO',
  // column menu actions
  s3bPickType: 'Оберіть тип колонки',
  s3bMore: 'Більше… (налаштувати)',
  s3bConfirm: 'Підтвердити',
  s3bReconfigure: 'Налаштувати',
  s3bUndo: 'Скасувати (повернути)',
  // block panel (UNKNOWN gate — Option A)
  s3bBlockTag: '▸ Є КОЛОНКИ БЕЗ ТИПУ',
  s3bBlockBody: 'Не можна продовжити, поки кожна колонка не отримає тип. Призначте тип або позначте «Ігнорувати» для:',
  s3bBlockFix: 'Перейти до першої',
  // config wizard
  s3bCfgStep1: 'КРОК 1 · ТИП',
  s3bCfgStep2: 'КРОК 2 · ПАРАМЕТРИ',
  s3bCfgFor: 'Налаштування колонки',
  s3bCfgApply: 'Застосувати',
  s3bCfgCancel: 'Скасувати',
  s3bCfgBack: 'Назад',
  s3bCfgPreview: 'ПОПЕРЕДНІЙ ПЕРЕГЛЯД',
  // worker progress panel (large file background processing)
  s3bWorkerTag: '▸ ВЕЛИКИЙ ФАЙЛ · ФОНОВА ОБРОБКА',
  s3bWorkerTitle: 'Розбираємо виписку',
  s3bWorkerBody: 'Файл великий, тож обробка йде у фоні — застосунок лишається чутливим. Ви можете спостерігати за прогресом.',
  s3bWorkerRows: 'рядків оброблено',
  s3bWorkerHint: '▸ 1–2 МІСЯЦІ РОЗБИРАЮТЬСЯ МИТТЄВО · ЦЕЙ БІЛЬШИЙ',
  // parse-error / rejection panel (ЩО/ЧОМУ/ДІЯ)
  s3bPerrTag: '▸ ПОМИЛКА РОЗБОРУ В КОЛОНЦІ',
  s3bPerrWhat: 'ЩО:',
  s3bPerrWhy: 'ЧОМУ:',
  s3bPerrDo: 'ДІЯ:',
  s3bPerrReview: 'Переглянути проблемні рядки',
  // navigation
  s3bNext: 'Далі ▸',
  s3bBack: 'Назад',
  s3bFoot: '▸ ЛОКАЛЬНО · ОФЛАЙН · СИРІ РЯДКИ ТИМЧАСОВІ — НЕ ЗБЕРІГАЮТЬСЯ',
  // help panel
  s3bHelpIntro: 'ПРО ЦЕЙ КРОК',
  s3bSelectColHint: 'Оберіть колонку, щоб побачити довідку про її тип.',
  // parameterized: showing(n, m) and ofFull(n, m)
  // 1.4 pattern: template strings with {n} / {m} placeholders
  s3bShowing: 'показано {n} з {m}',
  s3bOfFull: '{n} з {m} у файлі',
} as const;

export type ChromeKey = keyof typeof CATALOG_UK;
