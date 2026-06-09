// Structural NFR-003 guard — typecheck half.
//
// KNOWN LIMITATION (TypeScript project-references bypass exports map):
// Under `tsc -b` with pnpm workspace symlinks, TypeScript resolves `@abc-budget/engine/*`
// through the referenced project's outDir (.tsbuild/) rather than the package's `exports` map,
// so ANY deep path into engine internals resolves as a .d.ts file — the `exports` boundary is
// NOT enforced at the typecheck layer. See story/1.1 Task 6 report for details.
//
// The LINT boundary (eslint.config.mjs no-restricted-imports) IS enforced and catches deep
// imports in apps/web/**/*.{ts,tsx}. This file is excluded from lint so it does not trigger
// that rule (see ignores in eslint.config.mjs).
//
// This file is kept as a placeholder for the intended guard. If a future TypeScript release or
// workspace configuration change makes the exports map enforceable under project references,
// restore the @ts-expect-error approach:
//
//   // @ts-expect-error deep imports into engine internals must not resolve
//   import '@abc-budget/engine/src/internal/ping-engine';

export {};
