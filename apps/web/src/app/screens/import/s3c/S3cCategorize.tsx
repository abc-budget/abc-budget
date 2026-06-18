import { useLang } from '../../../i18n/LangProvider';
import { OpsPanel } from './OpsPanel';
import { RulePanel } from './RulePanel';
import { WhyPanel } from './WhyPanel';
import { SandboxBar } from './SandboxBar';
import { CreateCategoryDialog } from './CreateCategoryDialog';
import type { S3cSession } from './use-s3c-session';
import './s3c.css';

/**
 * S3cCategorize — the wizard step-3 container (Story 4.9a Task 4).
 *
 * A pure projection of useS3cSession: the OPS table (left) + the RUL/ build pane
 * OR the LOG/ why pane (right, mutually exclusive on `session.right`), with the
 * NEW/ create-category modal floating over both when `session.createCat` is set.
 *
 * The AltCore chrome (Stepper + LangToggle + step head/footer) is owned by
 * ImportFlow — like S3bMapping, this container renders only the split body.
 *
 * NFR-003: every data path is an EngineClient method reached through the hook;
 * this file imports DTO TYPES + presentational components only — no deep engine
 * reach.
 *
 * 4.9b: when the session's sandbox is engaged the SandboxBar mounts in a
 * full-width slot above OPS/RUL, the `.sandbox-on` frame lights the working
 * panels, and the RulePanel's edit / delete / reorder / dynamic-save callbacks
 * bind to the real session methods (live vs. sandbox lane decided worker-side).
 */

export interface S3cCategorizeProps {
  session: S3cSession;
}

export function S3cCategorize({ session }: S3cCategorizeProps) {
  const { lang } = useLang();
  const {
    window: win,
    fields,
    categoryIndex,
    segment,
    page,
    draft,
    draftCategoryId,
    rules,
    right,
    whyRowIndex,
    why,
    ruleTab,
    createCat,
  } = session;

  // The row the LOG/ pane explains (resolved from the live window by rowIndex —
  // NEVER the array index; the window slides under us).
  const whyRow = whyRowIndex != null ? win.rows.find((r) => r.rowIndex === whyRowIndex) ?? null : null;

  // Engaged = a held sandbox: light the hazard frame + mount the SandboxBar slot.
  const engaged = session.sandbox?.engaged ?? false;

  return (
    <div className={'s3c-split' + (engaged ? ' sandbox-on' : '')} data-testid="s3c-categorize">
      {engaged && (
        <div className="s3c-sandboxbar-slot">
          <SandboxBar
            count={session.sandbox!.count}
            changedOnly={session.changedOnly}
            onToggleChangedOnly={session.toggleChangedOnly}
            onApply={() => void session.applySandbox()}
            onCancel={() => void session.cancelSandbox()}
            lang={lang}
          />
        </div>
      )}

      <OpsPanel
        rows={win.rows}
        fields={fields}
        categories={categoryIndex}
        total={win.total}
        matchCount={win.matchCount}
        segment={segment}
        onSegment={session.setSegment}
        page={page}
        onPage={session.setPage}
        draft={draft}
        onAddCondition={session.addCondition}
        onCellClick={(rowIndex) => void session.openWhy(rowIndex)}
        lang={lang}
      />

      <div className="s3c-side">
        {right === 'why' && why && whyRow ? (
          <WhyPanel
            why={why}
            row={whyRow}
            categories={categoryIndex}
            onClose={session.closeWhy}
            lang={lang}
          />
        ) : (
          <RulePanel
            tab={ruleTab}
            onTab={session.setRuleTab}
            fields={fields}
            draft={draft}
            onDraft={session.setDraft}
            draftCategoryId={draftCategoryId}
            categories={categoryIndex}
            onPickCategory={session.pickCategory}
            rules={rules}
            liveMatchCount={win.matchCount}
            onSave={() => void (session.editingId == null ? session.saveRule() : session.submitEdit())}
            onCreateCategory={(name) => session.openCreateCategory(name, true)}
            lang={lang}
            editingId={session.editingId}
            onEditRule={session.openEdit}
            onDeleteRule={(id) => void session.deleteRule(id)}
            onReorder={(order) => void session.reorderRules(order)}
            saveLane={session.saveLane}
            engaged={engaged}
          />
        )}
      </div>

      {createCat && (
        <CreateCategoryDialog
          initialName={createCat.initialName}
          onCreate={(data) => void session.createCategory(data)}
          onCancel={session.closeCreateCategory}
          lang={lang}
        />
      )}
    </div>
  );
}
