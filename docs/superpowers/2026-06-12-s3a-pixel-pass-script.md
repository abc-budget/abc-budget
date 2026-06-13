# S3a Pixel-Pass Script (Story 2.7 — PM manual review)

Every S3a state, reachable by hand, desktop **and** ~390 px, uk **and** en. Each step was
executed live against the production bundle before this script was written — the expected
copy below is what actually renders, not what the catalog promises.

> **The one designed-by-dev surface:** the **DecodingPanel** (state 7) has NO bundle
> equivalent — it borrows the bundle's language (gold lamp header, the Dashboard gauge's
> 28-cell dot-matrix track, f-mono counts). Please eyeball it deliberately.

---

## 0 · Preconditions

```powershell
pnpm build      # tsc -b + vite build (workbox precache included)
pnpm preview    # serves the production bundle at http://localhost:4173
```

Open **http://localhost:4173/import** in Chrome.

**Reset to first-run (fresh IndexedDB):** DevTools (F12) → **Application** → **Storage**
→ **IndexedDB** → right-click the **`abc-budget`** database → **Delete database** → reload.
If the delete shows as *blocked* (the engine worker holds the DB open), use Application →
Storage → **Clear site data** instead, then reload. Note: *Clear site data* also clears
`localStorage` — the UI language resets to the browser default.

**Scratch files** (make them OUTSIDE the repo, e.g. in `$env:TEMP` — never commit them):

```powershell
# decode-progress files (synthetic, sample-statement headers):
node tools/make-synthetic-statement.mjs $env:TEMP\tmp-10k.csv 10000
node tools/make-synthetic-statement.mjs $env:TEMP\tmp-300k.csv 300000

# error state A — empty file (→ «no data rows» ЧОМУ):
New-Item -ItemType File $env:TEMP\empty.csv

# error state B — corrupt spreadsheet (→ «could not be parsed» ЧОМУ):
node -e "const b=Buffer.alloc(2048);b.write('PK');for(let i=4;i<2048;i++)b[i]=(i*37)%256;require('fs').writeFileSync(process.env.TEMP+'/corrupt.xlsx',b)"
```

> ⚠ A text-flavored `.pdf` does **NOT** demo the error state: the decoder's CSV fallback
> never rejects text — it reads the PDF source as rows and lands in **unknown** (verified
> live). Use `empty.csv` / `corrupt.xlsx` above.

**uk/en toggle:** the **UK / EN** buttons in the header, available in every state. For each
numbered step below: check the state in one language, toggle, re-check (the state is
preserved — toggling does not reset the flow).

**~390 px:** DevTools → device toolbar (Ctrl+Shift+M) → width 390 (e.g. iPhone 12 Pro).
Repeat each state's visual check once per width.

---

## 1 · First-run gate (base-currency dialog)

1. Reset IndexedDB (precondition above) → reload `/import`.
2. **Expect:** the **«Базова валюта» / «Base currency»** modal (scrim + screws + lamp)
   BEFORE any file work — the DropZone is visible but inert behind the scrim.
3. The select has TWO optgroups: curated 8 (`UAH USD EUR GBP PLN CHF CZK GEL`, prototype
   order, localized labels with symbols) above a full sorted reference. Preselect follows
   the browser locale (uk-UA → UAH, en-US → USD; outside the curated 8 the preselect sits
   in the lower group).
4. **Cancel** («Скасувати»/«Cancel») → navigates to `/` (Onboarding). Return to `/import` —
   the dialog gates again (nothing persisted).
5. **Continue** («Далі ▸»/«Continue ▸») → dialog closes, S3a live. Reload — no dialog
   (persisted).

## 2 · Idle (DropZone)

1. `/import` with base currency set.
2. **Expect:** dashed drop plate + cloud icon · «Перетягніть файл сюди»/«Drop the file
   here» · «або»/«or» · green **Обрати файл / Choose file** key · formats line
   `CSV · XLS · XLSX · up to 50 MB` · green lamp «ЛОКАЛЬНО · ФАЙЛ НЕ ПОКИДАЄ ПРИСТРІЙ» /
   «LOCAL · THE FILE NEVER LEAVES THIS DEVICE» · the «↳ Спробувати на прикладі»/«↳ Try a
   sample» link.
3. Footer: **Далі/Next is DISABLED** (1.5 disabled-key visual).
4. Drag a file over the zone → the `over` highlight appears, leaves on drag-out.

## 3 · Sample path → unknown (0/N) — the HONEST first-run state

1. From idle, click **↳ Спробувати на прикладі / Try a sample**.
2. **Expect (fresh pool):** the **UnknownPanel** — gold lamp «ЖОДНОЇ ВІДОМОЇ КОЛОНКИ»/«NO
   KNOWN COLUMN», eyebrow **0 / 7**, title «Перший імпорт — правил ще немає»/«First import —
   no rules yet», savedmap listing all 7 sample headers → «без типу»/«untyped», CRT note
   «▸ 7 колонок · усі без типу» + «→ КОЛОНКИ // наступний крок · next step».
3. FileChip above the panel: `sample-statement.csv · ~2 KB · 31 rows` with
   **Замінити/Replace** and **Прибрати/Remove**.
4. Footer: **Далі/Next is ENABLED** (unknown is a legitimate proceed path — mapping happens
   at S3b).

### Why unknown and not recognized? (the pre-2.8 reachability story — read me)

Recall prefills come ONLY from the learned pool (`recallPool` in IndexedDB); the built-in
auto-detect heuristic is **OFF by default and stays off**. The pool is populated exclusively
by `applyColumn` — the S3b mapping UI that ships at **2.8**. So in an S3a-only build
**nothing can warm the pool through the UI**: importing the sample twice still yields
unknown both times (verified live). On a fresh profile, **unknown IS the honest state** —
and steps 4–5 reach recognized via a documented dev seam instead.

## 4 · Recognized FULL (n = m) — via the dev seam

1. From idle (remove any file first), open the DevTools **Console** on `/import` and paste:

```js
await new Promise((resolve, reject) => {
  const open = indexedDB.open('abc-budget');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('recallPool', 'readwrite');
    const store = tx.objectStore('recallPool');
    store.clear();
    [
      { columnName: 'Дата i час операції', definition: 'date', params: { format: 'auto' } },
      { columnName: 'Деталі операції', definition: 'description', params: null },
      { columnName: 'MCC', definition: 'merchant_category', params: null },
      { columnName: 'Сума в валюті картки (UAH)', definition: 'amount', params: { currency: 'auto', type: 'auto' } },
      { columnName: 'Валюта', definition: 'currency', params: null },
      { columnName: 'Сума комісій (UAH)', definition: 'bank_commission', params: { currency: 'auto' } },
      { columnName: 'Сума кешбеку (UAH)', definition: 'cashback', params: { currency: 'auto' } },
    ].forEach((e) => store.put(e));
    tx.oncomplete = () => { db.close(); resolve('seeded 7'); };
    tx.onerror = () => reject(tx.error);
  };
});
```

   (Keys are the sample's headers verbatim — NB the first one contains a **Latin “i”**,
   copy-paste, don't retype. The pool key is NFC+trim normalized; these are already NFC.)
2. Click **↳ Try a sample**.
3. **Expect:** the **RecognizedPanel** — green lamp «РОЗПІЗНАНО З ВАШИХ ПРАВИЛ»/«RECALLED
   FROM YOUR RULES», eyebrow **7 / 7**, title «Усі 7 колонок розпізнано»/«All 7 columns
   recognized», **NO** gold partial line, savedmap rows `header → localized type` each with
   the «з правил»/«from rules» tag, the dedup info block (icon + copy, no numbers), the
   proceed note «▸ Кожен імпорт проходить перевірку…». **Далі/Next ENABLED.**

## 5 · Recognized PARTIAL (0 < n < m)

1. **Прибрати/Remove** the file → back to idle. Re-run the step-4 snippet keeping only the
   **first 3 entries** of the array (date, description, MCC).
2. Click **↳ Try a sample**.
3. **Expect:** same panel but title «Розпізнано 3 з 7 колонок»/«Recognized 3 of 7 columns»
   + the **gold-lamp partial line** «4 ще без типу — зіставите їх на наступному кроці.» /
   «4 still untyped — you’ll map them on the next step.»; 3 savedmap rows typed with the
   tag, 4 rows in the dimmed «без типу»/«untyped» style.
4. Cleanup after this step: re-run the snippet with an empty array `[]` (clears the pool
   back to honest-fresh).

## 6 · Read error (ЩО / ЧОМУ / ДІЯ)

1. From idle, pick `$env:TEMP\empty.csv`.
   **Expect:** ErrorPanel — orange lamp «НЕ ВДАЛОСЯ ПРОЧИТАТИ ФАЙЛ»/«COULDN’T READ THE
   FILE», `✕ empty.csv` line, CRT readout:
   - **ЩО/WHAT:** «Файл не вдалося відкрити»/«The file could not be opened»
   - **ЧОМУ/WHY:** «У файлі не знайшлося жодного рядка з даними.»/«No data rows were found
     in the file.»
   - **ДІЯ/DO:** «Перевірте, що це експорт виписки…»/«Make sure it’s a statement export…»
   Orange **Обрати інший файл / Choose another file** key. **Далі/Next DISABLED.**
2. Click the retry key → back to idle. Pick `$env:TEMP\corrupt.xlsx`.
   **Expect:** same panel, ЧОМУ now «Вміст не вдалося розібрати — файл пошкоджений або це
   не CSV/XLS/XLSX.»/«The content could not be parsed — the file is corrupted or not a
   CSV/XLS/XLSX.»

## 7 · Decode progress (DecodingPanel — the dev-designed surface)

1. From idle, pick `$env:TEMP\tmp-300k.csv` (≈27 MB).
2. **Expect, in order:** the panel appears with gold lamp «ЧИТАННЯ ФАЙЛУ»/«READING THE
   FILE», the file name in mono, first the indeterminate sweep + «ВІДКРИВАЄМО ФАЙЛ…»/
   «OPENING THE FILE…» (parsing — no honest counts yet), then the 28-cell dot track lights
   up with live mono counts «N / 300001 рядків»/«N / 300001 rows», then the summary panel
   (unknown 0/7 on a fresh pool). **Далі/Next stays DISABLED while decoding.**
3. Timing honesty: the counting window is short (row-keying is fast; the counts tick only
   while rows are keyed). `tmp-10k.csv` decodes in well under a frame — at 10k you will see
   the panel flash with the final count only; that is the engine being fast, not the panel
   being fake (the wire carries 11 intermediate events at 10k — pinned by the engine
   real-hop suite). Use the 300k file (or DevTools Performance → CPU ×6 on the 10k) for a
   leisurely look at the determinate state.

## 8 · Exit protection (bonus — while any session exists)

1. In recognized/unknown state, click **Назад/Back** (or the header logo).
2. **Expect:** the gold-lamp confirm modal «Перервати імпорт?»/«Abandon this import?» with
   **Залишитись/Stay** and orange **Перервати й вийти/Abandon & leave**. Stay keeps the
   flow intact; Leave lands on the target route.

---

## Coverage checklist (tick per cell)

| state | uk desktop | en desktop | uk 390px | en 390px |
|---|---|---|---|---|
| 1 first-run gate | ☐ | ☐ | ☐ | ☐ |
| 2 idle | ☐ | ☐ | ☐ | ☐ |
| 3 sample → unknown | ☐ | ☐ | ☐ | ☐ |
| 4 recognized full | ☐ | ☐ | ☐ | ☐ |
| 5 recognized partial | ☐ | ☐ | ☐ | ☐ |
| 6 error (×2 ЧОМУ) | ☐ | ☐ | ☐ | ☐ |
| 7 decode progress | ☐ | ☐ | ☐ | ☐ |
| 8 exit modal | ☐ | ☐ | ☐ | ☐ |
