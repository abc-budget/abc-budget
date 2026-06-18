/**
 * S3cSandboxHarness — DEV-ONLY live-view harness for the S3c layouts (Story 4.9b
 * Task 8 + 4.9c Task 8 Part E).  NOT shipped in the app: it is reachable only
 * through its own Vite HTML entry (`s3c-sandbox-harness.html`), mirroring the
 * existing gallery / qa-harness pattern.
 *
 * Two stub states, switchable via a small DEV toolbar so a browser at 390px can
 * measure both completion footers in one bundle:
 *
 *   • 'sandbox'    — the 4.9b engaged-sandbox layout: the SandboxBar slot, the
 *                    rules-list ↑↓ reorder, an OPS old→new diff row.
 *   • 'completion' — the 4.9c completion layout: the SelfCheckBanner (flagged
 *                    rows + reason chips), the blocked S3cGateBar (the «Призначити
 *                    решту» Auto-Other escape), and the AutoOtherModal reachable
 *                    via that button (magnitude with a per-currency pending tail).
 *
 * Methods are MOSTLY no-ops (a static visual harness), EXCEPT openAutoOther /
 * closeAutoOther in the completion stub, which flip a local flag so the modal is
 * reachable for the 390px measure.
 */
import { useState } from 'react';
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
  MAGNITUDE_MULTI,
  row,
  RULES_MULTI,
  TYPICALITY_MULTI,
} from './fixtures';
import type { TypicalityFlagDTO } from '@abc-budget/engine';

const CATS = [CAT_GROCERIES, CAT_TRANSPORT, CAT_TRAVEL];

/** No-op stubs shared by both harness states (a static visual harness). */
const NOOP_METHODS = {
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
  openAutoOther: async () => {},
  closeAutoOther: () => {},
  assignRemainder: async () => {},
  loadTypicality: async () => {},
  toggleAtypFirst: () => {},
  hideSelfCheck: () => {},
} as const;

/** A stub S3cSession in the engaged-sandbox state (an OPS diff row + 2 pending). */
const SANDBOX_SESSION: S3cSession = {
  window: {
    rows: [
      row({ rowIndex: 0, currency: 'UAH', amount: -249.5, description: 'АТБ МАРКЕТ', categoryId: 'groceries', ruleId: 1 }),
      row({ rowIndex: 1, currency: 'USD', amount: -42, description: 'BOOKING.COM', categoryId: 'travel', ruleId: 3 }),
      // an old→new diff row: УКЛОН flipped groceries → transport in the virtual tree
      diffRow({ rowIndex: 2, currency: 'UAH', amount: -1500, description: 'УКЛОН', categoryId: 'transport', previousCategoryId: 'groceries' }),
    ],
    total: 3,
    matchCount: 2,
    remainderCount: 0,
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
  // 4.9c surface — sandbox state has no remainder + no committed self-check.
  remainderCount: 0,
  magnitude: null,
  autoOtherOpen: false,
  typicalityMap: new Map(),
  atypFirst: false,
  selfCheckHidden: false,
  ...NOOP_METHODS,
};

/** Index the multi-reason typicality fixture by rowIndex (the OPS overlay map). */
const TYP_MAP = new Map<number, TypicalityFlagDTO>(TYPICALITY_MULTI.map((f) => [f.rowIndex, f]));

/**
 * A stub S3cSession in the 4.9c COMPLETION state: 3 ops still uncategorized (the
 * gate BLOCKS), 4 atypical rows flagged (the self-check banner shows + reason
 * chips on the OPS rows), and openAutoOther reachable.  Returned by a builder so
 * the local autoOtherOpen flag can drive the modal.
 */
function makeCompletionSession(autoOtherOpen: boolean, onOpen: () => void, onClose: () => void): S3cSession {
  return {
    window: {
      rows: [
        row({ rowIndex: 0, currency: 'UAH', amount: -249.5, description: 'АТБ МАРКЕТ', categoryId: 'groceries', ruleId: 1 }),
        row({ rowIndex: 1, currency: 'UAH', amount: -90, description: 'КАЗИНО ROYAL', categoryId: null, ruleId: null }),
        row({ rowIndex: 2, currency: 'UAH', amount: -8400, description: 'ВЕЛИКА ПОКУПКА', categoryId: null, ruleId: null }),
        row({ rowIndex: 5, currency: 'USD', amount: -42, description: 'ALIEXPRESS', categoryId: null, ruleId: null }),
        row({ rowIndex: 7, currency: 'UAH', amount: -120, description: 'НОВА ПОШТА', categoryId: 'transport', ruleId: 2 }),
      ],
      total: 8,
      matchCount: 8,
      remainderCount: 3,
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
    ruleTab: 'build',
    createCat: null,
    sandbox: null,
    changedOnly: false,
    editingId: null,
    saveLane: 'live',
    remainderCount: 3,
    magnitude: MAGNITUDE_MULTI,
    autoOtherOpen,
    typicalityMap: TYP_MAP,
    atypFirst: false,
    selfCheckHidden: false,
    ...NOOP_METHODS,
    // override the two methods that drive the modal so it is reachable at 390px
    openAutoOther: async () => onOpen(),
    closeAutoOther: () => onClose(),
  };
}

function Mounted() {
  // keep the lang reactive so the LangProvider context is satisfied
  useLang();
  const [state, setState] = useState<'sandbox' | 'completion'>('completion');
  const [autoOtherOpen, setAutoOtherOpen] = useState(false);
  const session =
    state === 'sandbox'
      ? SANDBOX_SESSION
      : makeCompletionSession(autoOtherOpen, () => setAutoOtherOpen(true), () => setAutoOtherOpen(false));
  return (
    <div style={{ padding: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => setState('completion')} disabled={state === 'completion'}>
          completion (4.9c)
        </button>
        <button type="button" onClick={() => setState('sandbox')} disabled={state === 'sandbox'}>
          sandbox (4.9b)
        </button>
      </div>
      <S3cCategorize session={session} />
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
