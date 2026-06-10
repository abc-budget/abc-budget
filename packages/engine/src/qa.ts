/**
 * ⚠️ UNSTABLE QA SURFACE — QA chrome only, NO semver promise.
 * Exists so qa-harness.html can drive the (internal) decoder before the real
 * EngineClient grows decode() over the worker transport at Story 2.6 — at which
 * point the harness switches to the client and this subpath SHRINKS/DIES (2.6 carry-forward).
 */
export { decode } from './internal/ingest/decode';
export type { DecodeInput, DecodeIssue, DecodeMeta, DecodeResult } from './internal/ingest/types';
