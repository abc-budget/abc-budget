/**
 * S3cSandboxHarness — DEV-ONLY live-view harness for the engaged-sandbox S3c
 * layout (Story 4.9b Task 8 Part C).  NOT shipped in the app: it is reachable
 * only through its own Vite HTML entry (`s3c-sandbox-harness.html`), mirroring
 * the existing gallery / qa-harness pattern.
 *
 * It mounts the real <S3cCategorize> over a STUB S3cSession seeded from the 4.9b
 * fixtures (RULES_MULTI, ROWS_MULTI_CURRENCY + a diffRow, sandbox engaged) so a
 * browser at 390px can show: the SandboxBar slot, the rules-list ↑↓ reorder, and
 * an OPS old→new diff row — all in one frame, with no wire / worker.  Methods are
 * no-ops (this is a static visual harness, not an interaction surface).
 */
import { LangProvider } from '../../../i18n/LangProvider';
import { useLang } from '../../../i18n/LangProvider';
import { S3cCategorize } from './S3cCategorize';
import type { S3cSession } from './use-s3c-session';
import {
  CAT_GROCERIES,
  CAT_TRANSPORT,
  CAT_TRAVEL,
  diffRow,
  FIELDS,
  row,
  RULES_MULTI,
} from './fixtures';

const CATS = [CAT_GROCERIES, CAT_TRANSPORT, CAT_TRAVEL];

/** A stub S3cSession in the engaged-sandbox state (an OPS diff row + 2 pending). */
const STUB_SESSION: S3cSession = {
  window: {
    rows: [
      row({ rowIndex: 0, currency: 'UAH', amount: -249.5, description: 'АТБ МАРКЕТ', categoryId: 'groceries', ruleId: 1 }),
      row({ rowIndex: 1, currency: 'USD', amount: -42, description: 'BOOKING.COM', categoryId: 'travel', ruleId: 3 }),
      // an old→new diff row: УКЛОН flipped groceries → transport in the virtual tree
      diffRow({ rowIndex: 2, currency: 'UAH', amount: -1500, description: 'УКЛОН', categoryId: 'transport', previousCategoryId: 'groceries' }),
    ],
    total: 3,
    matchCount: 2,
  },
  segment: 'all',
  page: 0,
  draft: [],
  draftCategoryId: null,
  rules: RULES_MULTI,
  categories: CATS,
  categoryIndex: new Map(CATS.map((c) => [c.id, c])),
  fields: FIELDS,
  right: 'build',
  whyRowIndex: null,
  why: null,
  ruleTab: 'rules',
  createCat: null,
  sandbox: { engaged: true, count: 2 },
  changedOnly: false,
  editingId: null,
  saveLane: 'live',
  // methods — no-ops (static harness)
  setDraft: () => {},
  addCondition: () => {},
  pickCategory: () => {},
  saveRule: async () => {},
  openWhy: async () => {},
  closeWhy: () => {},
  openCreateCategory: () => {},
  closeCreateCategory: () => {},
  createCategory: async () => {},
  setSegment: () => {},
  setPage: () => {},
  setRuleTab: () => {},
  openEdit: () => {},
  cancelEdit: () => {},
  submitEdit: async () => {},
  reorderRules: async () => {},
  deleteRule: async () => {},
  applySandbox: async () => {},
  cancelSandbox: async () => {},
  toggleChangedOnly: () => {},
};

function Mounted() {
  // keep the lang reactive so the LangProvider context is satisfied
  useLang();
  return (
    <div style={{ padding: 14, minWidth: 0 }}>
      <S3cCategorize session={STUB_SESSION} />
    </div>
  );
}

export function S3cSandboxHarness() {
  return (
    <LangProvider initialLang="uk">
      <Mounted />
    </LangProvider>
  );
}
