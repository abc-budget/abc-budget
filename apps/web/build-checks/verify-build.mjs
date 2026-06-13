/**
 * Build-output checks (Story 2.6 — the luxon/xlsx build discipline,
 * double-tagged since 2.2). Run AFTER `pnpm build`:
 *
 *   node build-checks/verify-build.mjs        (cwd: apps/web)
 *
 * Asserts, over dist/:
 *   (a) luxon and xlsx land in SEPARATE lazy chunks — present as files, NOT in
 *       the static import graph of any HTML entry (via .vite/manifest.json)
 *       and NOT statically imported by the worker entry chunk (every reference
 *       inside the worker chunk is a dynamic `import("./...")`).
 *   (b) the Workbox precache manifest (dist/sw.js, generateSW inlines it)
 *       INCLUDES those lazy chunks + the worker entry — offline parse depends
 *       on this (the mechanical halves of the offline proof).
 *   (c) the engine worker entry chunk exists (`engine-worker-*.js`).
 *   (d) the bundled sample statement (2.7 — the S3a sample path) is in the
 *       dist output AND the Workbox precache manifest (offline FEAT-001 path 2).
 *
 * Exit code 0 = all green; 1 = any failure (loud, listed).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const failures = [];
const ok = (msg) => console.log(`  OK  ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  console.error(`FAIL  ${msg}`);
};

if (!existsSync(dist)) {
  console.error(`FAIL  dist/ not found at ${dist} — run \`pnpm build\` first.`);
  process.exit(1);
}

const assets = readdirSync(join(dist, 'assets'));
const findChunk = (stem) => assets.find((f) => new RegExp(`^${stem}-[\\w-]+\\.js$`).test(f));

// ── (c) worker entry chunk exists ─────────────────────────────────────────────
const workerChunk = findChunk('engine-worker');
if (workerChunk) ok(`worker entry chunk exists: assets/${workerChunk}`);
else fail('worker entry chunk (engine-worker-*.js) NOT found in dist/assets');

// ── (a) luxon + xlsx are separate lazy chunks ────────────────────────────────
const lazyChunks = {
  luxon: findChunk('luxon'),
  xlsx: findChunk('xlsx'),
  'cpexcel.full': findChunk('cpexcel\\.full'), // xlsx codepage side-chunk rides along
};
for (const [name, file] of Object.entries(lazyChunks)) {
  if (file) ok(`${name} emitted as its own chunk: assets/${file}`);
  else fail(`${name} chunk NOT found in dist/assets — lazy split broken?`);
}

// (a.1) not in any HTML entry's STATIC graph (Vite manifest, transitive).
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));
const heavyFiles = Object.values(lazyChunks).filter(Boolean);

function staticClosure(key, seen = new Set()) {
  if (seen.has(key) || !manifest[key]) return seen;
  seen.add(key);
  for (const imp of manifest[key].imports ?? []) staticClosure(imp, seen);
  return seen;
}

for (const [key, entry] of Object.entries(manifest)) {
  if (!entry.isEntry) continue;
  const closureFiles = [...staticClosure(key)].map((k) => manifest[k].file);
  const leaked = heavyFiles.filter((f) => closureFiles.includes(`assets/${f}`));
  if (leaked.length === 0) ok(`entry '${key}' static graph is free of luxon/xlsx (${closureFiles.length} chunks)`);
  else fail(`entry '${key}' STATICALLY pulls heavy chunks: ${leaked.join(', ')}`);
}

// (a.2) worker entry chunk references luxon/xlsx ONLY via dynamic import(...).
if (workerChunk) {
  const workerSrc = readFileSync(join(dist, 'assets', workerChunk), 'utf8');
  for (const file of heavyFiles) {
    // Each match window carries the 12 chars BEFORE the chunk path: a dynamic
    // site looks like `import("./luxon-….js")`; anything else (`from"./…"`,
    // bare `import"./…"`) is a STATIC import — the discipline violation.
    const escaped = file.replaceAll('.', '\\.');
    const refs = [...workerSrc.matchAll(new RegExp(`.{0,12}\\./${escaped}`, 'g'))];
    const staticRefs = refs.filter((m) => !m[0].includes('import("'));
    if (refs.length === 0) {
      // not referenced from the worker at all (e.g. cpexcel is reached from xlsx) — fine
      ok(`worker chunk does not reference ${file} directly`);
    } else if (staticRefs.length === 0) {
      ok(`worker chunk references ${file} ONLY via dynamic import() (${refs.length} site(s))`);
    } else {
      fail(`worker chunk STATICALLY imports ${file}: ${staticRefs.map((m) => JSON.stringify(m[0])).join(' | ')}`);
    }
  }
}

// ── (b) Workbox precache includes the worker entry + lazy chunks ─────────────
const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
for (const file of [workerChunk, ...heavyFiles].filter(Boolean)) {
  if (sw.includes(file)) ok(`sw.js precache manifest includes assets/${file}`);
  else fail(`sw.js precache manifest MISSING assets/${file} — offline parse would 404`);
}

// ── (d) the S3a sample statement ships AND is precached (2.7) ─────────────────
const SAMPLE = 'sample-statement.csv';
if (existsSync(join(dist, SAMPLE))) ok(`sample asset exists: ${SAMPLE}`);
else fail(`sample asset MISSING from dist/: ${SAMPLE} — public/ copy broken?`);
if (sw.includes(SAMPLE)) ok(`sw.js precache manifest includes ${SAMPLE}`);
else fail(`sw.js precache manifest MISSING ${SAMPLE} — the offline sample path would 404`);

// ── Verdict ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\n${failures.length} build-check failure(s).`);
  process.exit(1);
}
console.log('\nAll build checks green (lazy split + precache + worker entry).');
