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
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@abc-budget/engine/*'],
              message:
                'UI may import ONLY the public @abc-budget/engine client surface (NFR-003). No deep imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // qa/ is allowed to import the UNSTABLE ./qa subpath only — all other deep engine imports
    // are still banned (NFR-003). This block overrides the apps/web/** rule above.
    files: ['apps/web/src/qa/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@abc-budget/engine/!(qa)'],
              message:
                'qa/ may only import the @abc-budget/engine/qa unstable subpath — no other deep engine imports (NFR-003).',
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
