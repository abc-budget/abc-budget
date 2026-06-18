/**
 * CategorizationService — the worker-side service shape behind the contract-v4
 * categorization wire surface (Story 4.9a S3c, EP-4).
 *
 * COORDINATION SEAM (Task 1 ↔ Task 2):
 *   Task 1 (this story) declares this INTERFACE and wires the direct-client to
 *   delegate to it (createDirectEngineClient → composeEngine().categorization).
 *   Task 2 (sibling) IMPLEMENTS it (the categorization assembly: window/segment
 *   filtering, why-tree evaluation, rule + category persistence) and wires the
 *   real instance into the composition root (ComposedEngine.categorization).
 *
 * Until Task 2 lands, `composeEngine` resolves `categorization: null` (the
 * deterministic no-impl baseline) and the direct-client's categorization methods
 * throw a loud "not implemented" — no categorization LOGIC lives in Task 1.
 *
 * The method shapes MIRROR the EngineClient categorization methods exactly (the
 * direct-client forwards 1:1) and return the SERIALIZABLE DTOs from client/dto.ts
 * — nothing class-shaped crosses back to the client.
 *
 * v5 (4.9b): rulesClassify, rulesSubmitEdit, sandboxState, sandboxApply,
 * sandboxCancel, and dropSandbox added. The sync methods (sandboxState,
 * sandboxCancel, dropSandbox) are wrapped to Promises by the async direct
 * client so EngineClient stays uniformly Promise-returning.
 */

import type {
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  CategorizedWindowDTO,
  WhyTreeDTO,
  RuleSummaryDTO,
  EditActionDTO,
  SandboxStateDTO,
  RemainderMagnitudeDTO,
  TypicalityResultDTO,
} from '../../client/dto';

/**
 * The categorization surface the direct-client delegates to. Implemented by
 * sibling Task 2; the signatures are fixed here so both tasks compile against
 * the same contract.
 */
export interface CategorizationService {
  importCategorizedRows(
    sessionId: string,
    opts: { offset: number; count: number; segment: 'all' | 'uncat'; draft?: ConditionDTO[]; changedOnly?: boolean },
  ): Promise<CategorizedWindowDTO>;

  importConditionFields(sessionId: string): Promise<ConditionFieldDTO[]>;

  importWhy(sessionId: string, rowIndex: number): Promise<WhyTreeDTO>;

  importRulesList(sessionId: string): Promise<RuleSummaryDTO[]>;

  rulesCreate(conditions: ConditionDTO[], categoryId: string): Promise<{ ruleId: number }>;

  categoriesList(): Promise<CategoryDTO[]>;

  categoriesCreate(input: { name: string; icon: string; currency: string }): Promise<CategoryDTO>;

  // v5 (4.9b sandbox): rule editing + sandbox surface.

  rulesClassify(sessionId: string, action: EditActionDTO): Promise<'live' | 'sandbox'>;
  rulesSubmitEdit(sessionId: string, action: EditActionDTO): Promise<SandboxStateDTO>;
  sandboxApply(sessionId: string): Promise<void>;
  sandboxState(sessionId: string): SandboxStateDTO;   // sync — wrapped to Promise by the async direct client
  sandboxCancel(sessionId: string): void;             // sync — wrapped likewise
  dropSandbox(sessionId: string): void;               // sync, internal (importAbort fire-and-forget)

  // v6 (4.9c): Auto-Other remainder + typicality self-check.

  importRemainderMagnitude(sessionId: string): Promise<RemainderMagnitudeDTO>;
  importAssignRemainder(sessionId: string, categoryId: string | null): Promise<void>;
  importTypicality(sessionId: string, opts?: { filteredFields?: string[] }): Promise<TypicalityResultDTO>;

  /** Drop the session's dump (fire-and-forget from importAbort). */
  dropDump(sessionId: string): void;
}
