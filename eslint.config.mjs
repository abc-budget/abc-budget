import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/.tsbuild/**',
      '**/node_modules/**',
      'functions/lib/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // NFR-003 fence: UI imports ONLY the public engine surface — the barrel and
    // the worker ENTRY subpath (`@abc-budget/engine/worker`, incl. Vite's
    // `?worker` query form — `*` does not cross `/`, so deep paths stay banned).
    // The 2.1 `engine/qa` exception SUNSET at 2.6 with the ./qa subpath itself.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@abc-budget/engine/*',
                '@abc-budget/engine/*/**',
                '!@abc-budget/engine/worker*',
              ],
              message:
                'UI may import ONLY the public @abc-budget/engine client surface or the /worker entry (NFR-003). No deep imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // ALTUS stays app-agnostic: props only — no engine, no app modules (1.3 spec §3).
    files: ['apps/web/src/ui/altus/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@abc-budget/engine', '@abc-budget/engine/*'],
              message: 'altus/ is app-agnostic — components take props, never talk to the engine.',
            },
            {
              group: ['../../**'],
              message: 'altus/ is app-agnostic — no imports from app modules above src/ui/altus/.',
            },
            {
              group: ['react-router', 'react-router/*', 'react-router-dom', 'react-router-dom/*'],
              message:
                'altus/ is router-agnostic — navigation chrome takes renderItem/callback props; the app layer injects links (1.5 spec §4).',
            },
          ],
        },
      ],
    },
  },
);
