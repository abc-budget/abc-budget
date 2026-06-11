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

### OER secret in the emulator

Create `functions/.secret.local` (already gitignored — see `.gitignore` below)
and add the secret the function expects:

```
OPENEXCHANGERATES_APP_ID=<your-key>
```

Alternatively, if the date you're testing is **already cached in Firestore**,
OER is never called and you can omit the secret entirely.

### Vite dev-server convenience override

When running `pnpm dev` (Vite's dev server, not the emulator), set:

```
VITE_RATES_URL=http://localhost:5001/abc-budget-2d379/europe-west1/getUSDRates
```

in `apps/web/.env.local`. This points the plain-fetch client directly at the
emulated function URL, bypassing the Hosting rewrite layer.

## Deployment

```bash
npx firebase-tools login
npx firebase-tools functions:secrets:set OPENEXCHANGERATES_APP_ID
npx firebase-tools deploy --only functions,hosting
```

Deploying hosting together is required so the `/api/rates` rewrite in
`firebase.json` takes effect in production.
