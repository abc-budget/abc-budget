import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/.tsbuild/**',
      '**/node_modules/**',
    ],
  },
  ...tseslint.configs.recommended,
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
);
