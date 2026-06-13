# S3b Pixel-Pass Script (Story 2.8 — PM manual review)

Every S3b state, reachable by hand, desktop **and** ~390 px, uk **and** en. S3b is
wizard **step 2** (Columns) — you reach it by completing S3a (step 1) and pressing
**Далі / Next**. The raw-mapping split-pane is the home base; each state below is a
right-pane panel or a column-header treatment over it.

> **The designed-by-dev surfaces — eyeball these deliberately (no bundle 1:1):**
> - **WorkerProgressPanel** (state 11) — REUSES the 2.7 DecodingPanel's HONEST
>   determinate primitive (real `done/total` off the worker `generate` events,
>   monotone). The bundle's WorkerPanel drove its bar from a `setInterval(+2)`
>   FAKE timer — that is **not** ported (HC-10: no progress theatre). The gauge
>   only moves when rows are actually keyed.
> - **The LOUD collision surface** (state 7) — decision #5 / item 3: a persistent
>   `⚠` column badge **and** a StatusPanel banner (both `role=alert`), NOT a
>   subtle dot. Confirm it persists across re-render until resolved.
> - **The ◇ recall affordance** (state 2) — item 3: a distinct gold glyph + dashed
>   underline on a recalled column header, not a faint marker.
>
> There is **no otherSheets note** at S3b (multi-sheet selection is an S3a/decode
> concern). There is **no filter toolbar** on the raw table (FEAT-022 → EP-5,
> decision #6) and **no universal/bank scope toggle** (FEAT-011 → deferred).

---

## 0 · Preconditions

```powershell
pnpm build      # tsc -b + vite build (workbox precache included)
pnpm preview    # serves the production bundle at http://localhost:4173
```

Open **http://localhost:4173/import** in Chrome. Set a base currency at the
cold-start gate (any — e.g. UAH), then you're at S3a.

**Reset to first-run (fresh IndexedDB) — clears the recall pool too:** DevTools
(F12) → **Application** → **Storage** → **IndexedDB** → right-click the
**`abc-budget`** database → **Delete database** → reload. If the delete shows as
*blocked* (the engine worker holds the DB open), use Application → Storage →
**Clear site data** instead, then reload. Note: *Clear site data* also clears
`localStorage` — the UI language resets to the browser default and the base-currency
gate returns.

**Scratch files** (make them OUTSIDE the repo, e.g. in `$env:TEMP` — never commit):

```powershell
# worker-progress file (synthetic, sample-statement headers — the 2.7 generator):
node tools/make-synthetic-statement.mjs $env:TEMP\tmp-10k.csv 10000
node tools/make-synthetic-statement.mjs $env:TEMP\tmp-300k.csv 300000

# >30% rejection fixture — copy the engine's bad-dates fixture out of the repo:
Copy-Item packages\engine\src\internal\ingest\fixtures\bad-dates.csv $env:TEMP\bad-dates.csv
```

> The **bad-dates.csv** fixture has a `Date` column with **5 of 13** values that
> are not dates (`not-a-date`, `garbage/date/here`, `INVALID DATE`, `??-??-??`,
> `BAD-DATE-VALUE`) ≈ 38 % > the 0.3 gate — mapping that column to **Date** trips
> the >30 % rollback (state 8). The other two columns map cleanly.

**uk/en toggle:** the **UK / EN** buttons in the header, available in every state.
For each numbered step below: check it in one language, toggle, re-check (state is
preserved — toggling does not reset the mapping).

**~390 px:** DevTools → device toolbar (Ctrl+Shift+M) → width 390 (e.g. iPhone 12
Pro). Repeat each state's visual check once per width — the split-pane stacks.

---

## How recall warms now (decision #4 — read me)

**Recall-prefilled (state 2) is reachable WITHOUT the dev seam.** Unlike the 2.7
S3a pixel pass — where nothing warmed the pool through the product, so the recall
state needed a hand-pasted IndexedDB snippet — at 2.8 the **S3b mapping UI warms
the pool through the product**: map a column and **advance** (press Далі → the
worker generates rows) once, and that mapping is committed to the recall pool. The
NEXT import of a file with the same header name(s) recalls them as **◇ guessed**.

The commit is **deferred to the advance** (decision #4): mapping a column *stages*
the write; only **importNext** (the advance) flushes it to the pool, and
**importAbort** (leave / S3a replace) discards it. So:

- **To reach recall-prefilled:** import any file → map at least one column → press
  **Далі** to finish → start a NEW import of a file sharing those header names →
  the columns come back **◇ guessed**. (The 2.7 dev-seam snippet still works if
  you want a specific pool, but it's no longer required for the happy path.)
- **The round-trip is pinned in code:** `s3b/round-trip.spec.tsx` drives the UI
  through map→advance→re-start (recalled) and map→abort→re-start (NOT recalled);
  the engine pins (a)/(b) prove the same at the engine layer.

---

## 1 · First-import (empty pool → all UNKNOWN)

1. Reset IndexedDB (precondition) → import the sample (S3a → **↳ Try a sample** →
   Далі), or any CSV. On a fresh pool every column lands at S3b **UNKNOWN**.
2. **Expect:** the split-pane — left **СИРА ВИПИСКА / RAW STATEMENT** table with
   each header in the loud orange **? без типу / ? no type** treatment and a
   **▸ не визначено / ▸ unknown** state line; right pane = **StatusPanel**
   («**СТАН ЗІСТАВЛЕННЯ / MAPPING STATUS**», the legend with the unknown count, the
   per-column status list, the recall note, the ▸ ABOUT-THIS-STEP `<details>`).
3. Footer: **Далі / Next is ALWAYS active** (Option A) — but pressing it here lands
   on the loud gate (state 9), not an advance.

## 2 · Recall-prefilled (◇ guessed, passes the gate)

1. Warm the pool first (see "How recall warms now"): map ≥1 column on a prior
   import and **finish** it. Then import a file with the same header(s).
2. **Expect:** the recalled column header shows the **◇ glyph + gold dashed
   underline** and a **з правил / from rules** state line; the StatusPanel legend
   counts it under **з правил / from rules** (gold). The recall note explains
   «з правил» = exact-name match, deterministic, not AI.
3. **Gate:** a recalled (guessed) column is **typed** → it is NOT in the unmapped
   list → pressing **Далі** advances with no mandatory confirm (decision #2). If
   every column is recalled, the import flows straight through.

## 3 · Manual instant map (a column → confirmed)

1. From any UNKNOWN column, click its header → the **ColMenu** opens (the
   **Оберіть тип колонки / Pick a column type** list + «**Більше… / More…**»).
2. Click a type with no params, e.g. **Опис / Description**.
3. **Expect:** the menu closes, the header flips to the green **✓ підтв. / ✓ set**
   confirmed treatment, the StatusPanel progress bar + counts update.

## 4 · «More» param config (ConfigWizard step 2 + help panel)

1. Open a column's menu → **Більше… (налаштувати) / More… (configure)**.
2. Step 1 = the type picker grid. Pick a param type (e.g. **Сума / Amount** or
   **Дата / Date**) → **Далі / Next**.
3. **Expect step 2** («**КРОК 2 · ПАРАМЕТРИ / STEP 2 · PARAMETERS**»): the
   per-type **ParamField** set, a scrollable **cfg-helpdoc** rendering the embedded
   markdown help for that type (offline, vendored — no fetch), and a **preview** of
   the column's sample values. For Amount, the currency segmented control includes
   **Фікс. код… / Fixed code…** → type an ISO (e.g. `USD`); for Date,
   **Власний / Custom** → type a pattern. **Застосувати / Apply** maps it.

## 5 · Confirm-recalled (◇ → confirmed)

1. On a **◇ guessed** column (state 2), open its menu.
2. **Expect** a **«Підтвердити: <Type> / Confirm: <Type>»** item at the top
   (present only for guessed columns).
3. Click it → the **◇** glyph clears, the header flips to **✓ підтв. / ✓ set**
   (optimistic — the engine's confirm returns void; it reconciles on the next
   snapshot).

## 6 · Undo / reconfigure (mapped → reset / reopen)

1. On any mapped column (guessed or confirmed), open its menu.
2. **Налаштувати / Reconfigure** → reopens the **ConfigWizard at step 2** for that
   column (change params without re-picking the type).
3. **Скасувати (повернути) / Undo (revert)** → the column drops back to **UNKNOWN**
   (and the staged recall write for it is unstaged).

## 7 · Collision (loud affordance — column badge + StatusPanel banner)

1. Reach a state where a saved rule's params **differ** from what you're applying:
   warm the pool with column «X» → params A (map + advance), then re-import and
   map «X» → params B (use «More» to pick a different currency/format).
2. **Expect (decision #5, item 3):** a **persistent** loud surface — a **⚠ badge on
   the column header** («**правило ≠ · підтвердьте/змініть / saved rule's params
   differ · confirm/adjust**», `role=alert`) **and** a **CollisionBanner** atop the
   StatusPanel (`role=alert`) offering **Оновити правило / Update the rule** (LWW
   overwrite) and **Лишити збережене / Keep saved** (no-clobber).
3. It does **NOT** block the gate (the column is typed). It persists across
   re-renders until you resolve it; either choice dismisses it.

## 8 · >30 % rejection (RejectionPanel, all cellErrors, column UNKNOWN, session alive)

1. Import `$env:TEMP\bad-dates.csv`. At S3b, map the **Date** column → **Date** (or
   «More» → Date → Apply).
2. **Expect:** the right pane becomes the **RejectionPanel** —
   «**▸ ПОМИЛКА РОЗБОРУ В КОЛОНЦІ / ▸ PARSE ERROR IN COLUMN**» with ЩО/ЧОМУ/ДІЯ
   (WHAT/WHY/DO) and **the FULL list of every failing row** (not truncated — 5
   rows for bad-dates). The **Date column stays UNKNOWN** (the apply rolled back).
3. **Session alive:** the other columns are still mappable — map **Amount** and
   **Description** normally; the engine session is unaffected.

## 9 · Loud UNKNOWN gate (Option A — «Далі» with unmapped → BlockPanel)

1. From first-import (state 1) or any state with ≥1 UNKNOWN column, press
   **Далі / Next**.
2. **Expect:** the right pane becomes the **BlockPanel** — orange lamp
   «**▸ Є КОЛОНКИ БЕЗ ТИПУ / ▸ COLUMNS WITHOUT A TYPE**», the explanatory body, a
   **chip per unmapped column** (`✕ <name>`, click = jump-to-fix), and a
   **«Перейти до першої / Go to first»** key. **No advance** — you stay on step 2.
3. Map every column → press Далі again → it advances (state 11 / S3c).

## 10 · IGNORE & TIME handled (pass the gate, NOT counted unknown)

1. On an UNKNOWN column, open the menu → pick **Ігнорувати / Ignore** (last item,
   styled apart). The header shows the muted **ігнор. / ignored** state.
2. Map another column to **Час / Time**.
3. **Expect:** neither **ignore** nor **time** is counted as UNKNOWN — both are
   "typed" for the gate. With every other column typed, **Далі** advances (the
   BlockPanel does not appear).

## 11 · Worker-progress (importNext intermediate determinate render)

1. Map every column on a **large** file (use `$env:TEMP\tmp-10k.csv`, or
   `tmp-300k.csv` for a leisurely look), then press **Далі / Next**.
2. **Expect:** the right pane becomes the **WorkerProgressPanel** —
   «**▸ ВЕЛИКИЙ ФАЙЛ · ФОНОВА ОБРОБКА / ▸ LARGE FILE · BACKGROUND PROCESSING**»,
   the dot-matrix worker-gauge, and a live **N% · N / TOTAL рядків / rows** readout
   driven by the real `generate` progress events. Then it advances to S3c.
3. Timing honesty: at 10k the generate window is short — you may see the gauge
   flash to the final count; that's the engine being fast, not the panel being
   fake (the wire carries intermediate events — pinned by the engine real-hop
   suite). Use the 300k file or DevTools Performance → CPU ×6 for the determinate
   ticking. **The staged recall flush rides this same advance** (decision #4).

## 12 · «Назад» → S3a (non-destructive)

1. From S3b, press **Назад / Back**.
2. **Expect:** you land on **S3a (step 1)** with the file still loaded — **no
   leave-confirm modal** (this is internal step nav, not a flow exit) and **no
   importAbort**. Press **Далі** to return to S3b: the **same mapping state**
   survives (applied columns intact; the session was never restarted).
3. Contrast: only S3a's explicit **Замінити / Replace** or **Прибрати / Remove**
   aborts the session → returning to S3b starts all-UNKNOWN (a fresh pass).

---

## Coverage checklist (tick per cell)

| # | state | uk desktop | en desktop | uk 390px | en 390px |
|---|---|---|---|---|---|
| 1 | first-import (all UNKNOWN) | ☐ | ☐ | ☐ | ☐ |
| 2 | recall-prefilled (◇ guessed) | ☐ | ☐ | ☐ | ☐ |
| 3 | manual instant map | ☐ | ☐ | ☐ | ☐ |
| 4 | «More» param config (step 2 + help) | ☐ | ☐ | ☐ | ☐ |
| 5 | confirm-recalled (◇ → confirmed) | ☐ | ☐ | ☐ | ☐ |
| 6 | undo / reconfigure | ☐ | ☐ | ☐ | ☐ |
| 7 | collision (loud badge + banner) | ☐ | ☐ | ☐ | ☐ |
| 8 | >30% rejection (all cellErrors) | ☐ | ☐ | ☐ | ☐ |
| 9 | loud UNKNOWN gate (BlockPanel) | ☐ | ☐ | ☐ | ☐ |
| 10 | IGNORE & TIME handled | ☐ | ☐ | ☐ | ☐ |
| 11 | worker-progress | ☐ | ☐ | ☐ | ☐ |
| 12 | «Назад» → S3a (non-destructive) | ☐ | ☐ | ☐ | ☐ |
