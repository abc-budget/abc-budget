/**
 * s3c-390.e2e.ts — DEV 390px live-measure for the S3c completion footer (Story
 * 4.9c Task 8 Part E).  Drives the dev harness `s3c-sandbox-harness.html` in its
 * COMPLETION state (the SelfCheckBanner + the blocked S3cGateBar + flagged OPS
 * rows with reason chips + the AutoOtherModal reachable) at iPhone-12 width and
 * asserts NO horizontal overflow.
 *
 * NOT part of the test suite or the typecheck:
 *   - vitest only globs `src/**\/*.spec.{ts,tsx}` (this is `.e2e.ts`);
 *   - `apps/web/tsconfig.json` excludes `**\/*.e2e.ts` (Playwright is NOT a repo
 *     dependency — the controller measures via the Playwright MCP);
 *   - `eslint.config.mjs` ignores `**\/*.e2e.ts`.
 *
 * The controller runs this through the Playwright MCP against a running dev
 * server.  The SERVICE-WORKER cache MUST be cleared first (the 4.9b stale-SW
 * gotcha) BEFORE navigating, or a stale bundle measures the wrong CSS.
 *
 * Harness URL (dev server on :5173):
 *   http://localhost:5173/s3c-sandbox-harness.html
 * The harness opens in the 'completion' state by default; the «Призначити
 * решту» gate button opens the AutoOtherModal for the modal measure.
 */
// @ts-nocheck — Playwright is not a repo dependency (see file header).
import { test, expect } from '@playwright/test';

const HARNESS_URL = 'http://localhost:5173/s3c-sandbox-harness.html';

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page, context }) => {
  // Clear the SW cache FIRST (the 4.9b stale-SW gotcha) — unregister every SW
  // + drop cookies before the first navigation so a fresh bundle is measured.
  await context.clearCookies();
  await page.goto(HARNESS_URL);
  await page.evaluate(async () => {
    const rs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(rs.map((r) => r.unregister()));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  });
  await page.reload();
});

/** scrollWidth − clientWidth === 0 ⇒ no horizontal overflow at this width. */
async function overflow(page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test('390px: the completion footer (gate + self-check + flagged rows) does not overflow', async ({ page }) => {
  // the completion harness renders the gate bar, the self-check banner, and the
  // flagged OPS rows with reason chips in one frame.
  await expect(page.getByTestId('s3c-gate')).toBeVisible();
  await expect(page.getByTestId('self-check')).toBeVisible();
  await expect(page.locator('.gate.blocked')).toBeVisible();
  expect(await overflow(page)).toBe(0);
});

test('390px: the Auto-Other modal does not overflow', async ({ page }) => {
  await page.getByRole('button', { name: /Призначити решту/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await overflow(page)).toBe(0);
});
