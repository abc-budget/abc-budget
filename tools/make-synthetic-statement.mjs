// Synthetic statement generator (Story 2.7 — PM pixel pass + progress-pin evidence).
//
// Headers match apps/web/public/sample-statement.csv EXACTLY (including the
// Latin "i" in the first header — mono-style); rows are fully synthetic, NO
// real data. Used to produce the large decode-progress files for the manual
// pixel pass — the outputs are scratch files and must NOT be committed
// (write them outside the repo, e.g. $env:TEMP).
//
// Usage: node tools/make-synthetic-statement.mjs <outPath> [rows=10000]
//   e.g. node tools/make-synthetic-statement.mjs $env:TEMP\tmp-10k.csv 10000
import { writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) {
  console.error('usage: node tools/make-synthetic-statement.mjs <outPath> [rows=10000]');
  process.exit(1);
}
const rows = Number(process.argv[3] ?? 10000);

const header =
  '"Дата i час операції","Деталі операції","MCC","Сума в валюті картки (UAH)","Валюта","Сума комісій (UAH)","Сума кешбеку (UAH)"';
const merchants = ['КАВʼЯРНЯ ЗРАЗОК', 'СУПЕРМАРКЕТ ПРИКЛАД', 'АПТЕКА ДЕМО', 'ЗАПРАВКА ТЕСТ', 'КІНО СИНТЕТИКА'];
const mcc = ['5814', '5411', '5912', '5541', '7832'];

const lines = [header];
for (let i = 0; i < rows; i++) {
  const day = String(1 + (i % 28)).padStart(2, '0');
  const month = String(1 + (Math.floor(i / 28) % 12)).padStart(2, '0');
  const hh = String(i % 24).padStart(2, '0');
  const mm = String(i % 60).padStart(2, '0');
  const amount = `-${(50 + (i % 950)).toFixed(0)},${String(i % 100).padStart(2, '0')}`;
  const k = i % merchants.length;
  lines.push(
    `"${day}.${month}.2026 ${hh}:${mm}:00","${merchants[k]}","${mcc[k]}","${amount}","UAH","—","0,${String((i % 90) + 10)}"`,
  );
}
writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log(`wrote ${out}: ${rows} data rows`);
