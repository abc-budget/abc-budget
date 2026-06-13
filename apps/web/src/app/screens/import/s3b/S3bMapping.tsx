import { useCallback, useState } from 'react';
import type { SerializedMessage, Stage2ColumnDTO } from '@abc-budget/engine';
import { useLang } from '../../../i18n/LangProvider';
import type { ChromeKey } from '../../../i18n/i18n';
import { t as translate } from '../../../i18n/i18n';
import { RawMappingTable } from './RawMappingTable';
import { StatusPanel } from './StatusPanel';
import { ConfigWizard } from './ConfigWizard';
import { RejectionPanel } from './RejectionPanel';
import type { RejectionInfo } from './RejectionPanel';
import { BlockPanel } from './BlockPanel';
import { WorkerProgressPanel } from './WorkerProgressPanel';
import { CollisionBanner } from './CollisionBanner';
import type { MappingCell, MappingColumn } from './types';
import type { S3bSession } from './use-s3b-session';
import './s3b.css';

/**
 * S3bMapping — the wizard step-2 container (Story 2.8, Task 4).
 *
 * Owns the INTERNAL right-pane view (default StatusPanel / ConfigWizard /
 * RejectionPanel) driven by menu interactions; the BLOCK and WORKER views are
 * GATE-driven and owned by ImportFlow (passed as `gateView` — the gate is a
 * flow-level concern: «Далі» with unmapped → block, advance → worker takeover).
 *
 * DTO→view-model adapter: Stage2ColumnDTO.originalName (a SerializedMessage) →
 * `rawName` string; each sampleCell's error/ignore SerializedMessage → a
 * resolved display string (so the pure components stay engine-free).  Column
 * names off the wire are Native text (`{text}`) — keys are the localizable
 * fallback path (best-effort via the chrome catalog, then the raw key).
 */

export interface S3bMappingProps {
  session: S3bSession;
  /** File label for the raw table header. */
  fileLabel: string;
  /** Total row count (the 10-cell sample is a transient window). */
  totalRows: number;
  /** Gate-driven overlay view, owned by ImportFlow. */
  gateView: 'mapping' | 'block' | 'worker';
  /** importNext progress (only meaningful when gateView === 'worker'). */
  progress: { done: number; total: number };
  /**
   * Dismiss the gate (block) overlay back to the mapping view — owned by
   * ImportFlow (it owns `gateView`).  The gate's «ДІЯ» (jump to an unmapped
   * column + open its type-menu) is only reachable if `gateView` returns to
   * 'mapping'; otherwise the menu is force-closed at the table (`openColId`
   * gate below) and the affordance is a dead no-op (EP-2 FINDING-EP-1).
   */
  onReturnToMapping: () => void;
}

/**
 * Resolve a SerializedMessage to a display string.
 * Native (`{text}`) → text verbatim.  Localizable (`{key, params}`) → the chrome
 * catalog rendering when the key exists there, else the raw key (best-effort —
 * engine cell-error keys are not part of the web chrome catalog at 2.8).
 */
function resolveMessage(msg: SerializedMessage, lang: 'uk' | 'en'): string {
  if ('text' in msg) return msg.text;
  try {
    const rendered = translate(lang, msg.key as ChromeKey, msg.params as Record<string, string | number>);
    return rendered ?? msg.key;
  } catch {
    return msg.key;
  }
}

function adaptCell(
  cell: Stage2ColumnDTO['sampleCells'][number],
  lang: 'uk' | 'en',
): MappingCell {
  const value = cell.value;
  const out: MappingCell = {
    value: value === null || value === undefined ? null : String(value),
  };
  if (cell.error) out.error = resolveMessage(cell.error, lang);
  if (cell.ignore) out.ignore = resolveMessage(cell.ignore, lang);
  return out;
}

function adaptColumn(col: Stage2ColumnDTO, lang: 'uk' | 'en'): MappingColumn {
  return {
    id: col.id,
    rawName: resolveMessage(col.originalName, lang),
    definition: col.definition,
    recallState: col.recallState,
    sampleCells: col.sampleCells.map((c) => adaptCell(c, lang)),
  };
}

export function S3bMapping({ session, fileLabel, totalRows, gateView, progress, onReturnToMapping }: S3bMappingProps) {
  const { lang } = useLang();
  const { snapshot, rejection, collisionColumnId } = session;

  /** The inline-open column menu, or null. */
  const [openColId, setOpenColId] = useState<string | null>(null);
  /** The column being configured in the «More» wizard, or null. */
  const [configColId, setConfigColId] = useState<string | null>(null);

  const columns = snapshot.columns.map((c) => adaptColumn(c, lang));
  const byId = (id: string) => columns.find((c) => c.id === id) ?? null;

  const closeMenu = useCallback(() => setOpenColId(null), []);

  const onPick = useCallback(
    (columnId: string, definition: string) => {
      closeMenu();
      void session.applyInstant(columnId, definition);
    },
    [session, closeMenu],
  );

  const onMore = useCallback(
    (columnId: string) => {
      closeMenu();
      setConfigColId(columnId);
    },
    [closeMenu],
  );

  const onReconfigure = onMore;

  const onUndo = useCallback(
    (columnId: string) => {
      closeMenu();
      void session.reset(columnId);
    },
    [session, closeMenu],
  );

  const onConfirm = useCallback(
    (columnId: string) => {
      closeMenu();
      void session.confirmRecall(columnId);
    },
    [session, closeMenu],
  );

  const onApplyWizard = useCallback(
    (definition: string, uiValues: Record<string, string>) => {
      const columnId = configColId;
      setConfigColId(null);
      if (columnId) void session.apply(columnId, definition, uiValues);
    },
    [session, configColId],
  );

  const onJump = useCallback(
    (columnId: string) => {
      // Dismiss the gate overlay FIRST (EP-2 FINDING-EP-1): while gateView !==
      // 'mapping' the table force-closes every menu (openColId gate below), so
      // setting openColId without returning to the mapping view is a no-op — the
      // gate's «Перейти до першої» / chip clicks would do nothing.  Returning to
      // mapping + opening the column's menu in one action makes «ДІЯ» reachable.
      onReturnToMapping();
      setConfigColId(null);
      setOpenColId(columnId);
    },
    [onReturnToMapping],
  );

  // ── Loud save-collision affordance (decision #5) ───────────────────────────
  // Persistent + non-blocking: rendered on the colliding column header (a loud
  // badge) AND atop the default StatusPanel (the resolve banner).  It does NOT
  // gate-block: the column is typed, so it passes canAdvance() #2.
  const collisionCol = collisionColumnId ? byId(collisionColumnId) : null;
  const collisionBanner =
    snapshot.lastSaveCollision && collisionCol ? (
      <CollisionBanner
        columnName={collisionCol.rawName}
        onConfirm={() => void session.resolveCollision(true)}
        onDecline={() => void session.resolveCollision(false)}
      />
    ) : null;

  // ── Right pane resolution ──────────────────────────────────────────────────
  // Gate views (block / worker) take precedence — they're flow-level overlays.
  let rightPane: React.ReactNode;
  if (gateView === 'worker') {
    rightPane = <WorkerProgressPanel done={progress.done} total={progress.total} />;
  } else if (gateView === 'block') {
    const unmapped = snapshot.unmapped.map((u) => byId(u.id)).filter((c): c is MappingColumn => c !== null);
    rightPane = <BlockPanel unmappedColumns={unmapped} onJump={onJump} />;
  } else if (rejection) {
    const rejCol = byId(rejection.columnId);
    const info: RejectionInfo = {
      errorCount: rejection.rejection.errorCount,
      totalCount: rejection.rejection.totalCount,
      threshold: rejection.rejection.threshold,
      cellErrors: rejection.rejection.cellErrors.map((ce) => ({
        rowIndex: ce.rowIndex,
        message: resolveMessage(ce.message, lang),
      })),
    };
    rightPane = (
      <RejectionPanel
        rejection={info}
        columnName={rejCol?.rawName ?? rejection.columnId}
        onRetry={() => onJump(rejection.columnId)}
      />
    );
  } else if (configColId) {
    const col = byId(configColId);
    rightPane = col ? (
      <ConfigWizard column={col} onApply={onApplyWizard} onCancel={() => setConfigColId(null)} />
    ) : null;
  } else {
    rightPane = <StatusPanel columns={columns} onJump={onJump} collisionBanner={collisionBanner} />;
  }

  return (
    <div className="split" data-testid="s3b-mapping" onClick={closeMenu}>
      <RawMappingTable
        columns={columns}
        fileLabel={fileLabel}
        totalRows={totalRows}
        openColId={gateView === 'mapping' ? openColId : null}
        collisionColId={collisionColumnId}
        onOpenCol={setOpenColId}
        menu={{ onPick, onMore, onUndo, onReconfigure, onConfirm }}
      />
      <div className="split-side">{rightPane}</div>
    </div>
  );
}
