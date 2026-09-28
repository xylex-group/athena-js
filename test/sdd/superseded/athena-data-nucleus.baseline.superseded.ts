/**
 * SUPERSEDED by test/sdd/athena-data-nucleus.target.test.ts
 *
 * Former characterization of PR #697 CURRENT defects
 * (`runPrepareAndBefore` after model/policy/HTTP limits).
 * Found-case pin: feat/athena-js-policy-dx-b-f SHA 35a1b29a9.
 *
 * - B-ADN-ORDER: model/policy/limit run before prepare*
 * - B-ADN-COMBINED: runPrepareAndBefore merges prepare+before
 * - B-ADN-PREPARE-REPLACES: prepareInsert/prepareUpdate can replace the payload that reaches the backend
 * - B-ADN-PREPARE-DELETE: prepareDelete return ignored
 * - B-ADN-UPSERT-INSERT: upsert is semantic decoration over insert
 * - B-ADN-BEFORE-MUTABLE: before hooks see mutable payload refs
 * - B-ADN-AFTER-SWALLOWED: after has no result; after failures swallowed
 * - B-ADN-EVENT-BEFORE-AFTER: execution events before after hooks finish
 * - B-ADN-NO-IDS: no eventId/traceId/error phase/commit guarantee
 * - B-ADN-NO-HOOK-TIMING: no hook timings
 * - B-ADN-INJECT-AFTER-AUTHORIZE: prepareInsert can inject a field after policy validation
 * - B-ADN-LIMITS-PRE-PREPARE: inspectPayloadLimits never re-runs after prepare
 *
 * Phases 0–6 inverted the #697 combined-runner defects (internal nucleus,
 * prepare → policy rewrite → final gates → branded freeze → before veto).
 * Do not invert titles in place. Target suite is the CI source of truth.
 *
 * Active baseline file moved after implement. Kept as a record only
 * (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY = "test/sdd/athena-data-nucleus.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-ADN-ORDER: P?: model/policy/limit run before prepare*",
  "B-ADN-COMBINED: P?: runPrepareAndBefore merges prepare+before",
  "B-ADN-PREPARE-REPLACES: P?: prepareInsert/prepareUpdate can replace the payload that reaches the backend",
  "B-ADN-PREPARE-DELETE: P?: prepareDelete return ignored",
  "B-ADN-UPSERT-INSERT: P?: upsert is semantic decoration over insert",
  "B-ADN-BEFORE-MUTABLE: P?: before hooks see mutable payload refs",
  "B-ADN-AFTER-SWALLOWED: P?: after has no result; after failures swallowed",
  "B-ADN-EVENT-BEFORE-AFTER: P?: execution events before after hooks finish",
  "B-ADN-NO-IDS: P?: no eventId/traceId/error phase/commit guarantee",
  "B-ADN-NO-HOOK-TIMING: P?: no hook timings",
  "B-ADN-INJECT-AFTER-AUTHORIZE: P?: prepareInsert can inject a field after policy validation",
  "B-ADN-LIMITS-PRE-PREPARE: P?: inspectPayloadLimits never re-runs after prepare",
] as const;
