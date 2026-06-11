# functions/

Cloud Functions for the ABC Budget Firebase project (`abc-budget-2d379`).

## Local development

Use the Firebase Emulator Suite to run hosting + functions together.
The `/api/rates` Hosting rewrite works inside the emulator, so the built web
app calls the local function exactly as it would in production.

```bash
# From the workspace root — build the web app first so hosting has something to serve:
pnpm build

# Then start emulators (hosting + functions):
npx firebase-tools emulators:start --only hosting,functions
```

The emulator hosting UI is at http://localhost:5000 by default.
The function runs at http://localhost:5001.

> **Note:** The emulator runtime sets `FUNCTIONS_EMULATOR=true` automatically. The function
> uses this to admit `http://localhost:5000` and `http://127.0.0.1:5000` into the origin
> allowlist — so the hosted app's same-origin requests pass the origin gate in dev without
> any manual config. This env var is never present in deployed Cloud Functions, so the
> prod allowlist stays prod-only by construction (ENT-004).

### OER secret in the emulator

Create `functions/.secret.local` (already gitignored — see `.gitignore` below)
and add the secret the function expects:

```
OPENEXCHANGERATES_APP_ID=<your-key>
```

Alternatively, if the date you're testing is **already cached in Firestore**,
OER is never called and you can omit the secret entirely.

### Vite dev-server note (`VITE_RATES_URL`)

⚠️ Pointing `VITE_RATES_URL` directly at the function URL does **NOT** work against the
origin gate: a browser POST from Vite (`http://localhost:5173`) carries that localhost
Origin, which is deliberately absent from the prod-only allowlist → `403 origin-forbidden`
(ENT-004: no localhost in the prod allowlist — any local process could claim it).

**The supported dev flow is the emulator-with-rewrite path above** (same-origin, like prod).
`VITE_RATES_URL` exists only for special local setups (e.g. a locally-relaxed allowlist in
your working copy — never committed). The override is build-time and defaults to the
relative path, so it cannot leak into prod builds.

## Deployment

```bash
npx firebase-tools login
npx firebase-tools functions:secrets:set OPENEXCHANGERATES_APP_ID
npx firebase-tools deploy --only functions,hosting
```

Deploying hosting together is required so the `/api/rates` rewrite in
`firebase.json` takes effect in production.
