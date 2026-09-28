/**
 * SUPERSEDED by test/sdd/athena-data-lifecycle-security.target.test.ts
 *
 * Former Wave 1 characterization of PR #697 found-case order
 * (feat/athena-js-policy-dx-b-f SHA 35a1b29a9):
 * - B-DLS-COMBINED-AFTER-AUTHZ: runPrepareAndBefore after model/policy/HTTP limits
 * - B-DLS-PREPARE-MUTATES-BODY: prepare* writes insert_body/update_body after authz
 * - B-DLS-PREPARE-DELETE-DEAD: prepareDelete present but cannot alter the request
 * - B-DLS-BEFORE-MUTATES-TRANSPORT: before* can mutate the transport-bound request
 * - B-DLS-INJECT-AFTER-AUTHORIZE: prepareInsert can inject a field after policy
 * - B-DLS-LIMITS-PRE-PREPARE: inspectPayloadLimits never re-runs after prepare
 * - B-DLS-MAX-BODY-UNUSED: maxBodyBytes is typed but unused on the hot path
 *
 * Wave 1 inverted the insecure order (split runPrepare/runBefore,
 * prepare-before-authorize, freeze/clone before before*, remove prepareDelete).
 * Do not invert titles in place. Target suite is the CI source of truth.
 *
 * Active baseline file moved after implement. Kept as a record only
 * (not a *.test.ts file so CI does not run it).
 */
export const SUPERSEDED_BY =
  "test/sdd/athena-data-lifecycle-security.target.test.ts";

export const SUPERSEDED_IDS = [
  "B-DLS-COMBINED-AFTER-AUTHZ: P?: runPrepareAndBefore runs after model/policy/HTTP limits",
  "B-DLS-PREPARE-MUTATES-BODY: P?: prepare* writes insert_body/update_body after authorization",
  "B-DLS-PREPARE-DELETE-DEAD: P?: prepareDelete is present but cannot alter the request",
  "B-DLS-BEFORE-MUTATES-TRANSPORT: P?: before* sees and can mutate the transport-bound request",
  "B-DLS-INJECT-AFTER-AUTHORIZE: P?: prepareInsert can inject a field after policy validation",
  "B-DLS-LIMITS-PRE-PREPARE: P?: inspectPayloadLimits never re-runs after prepare",
  "B-DLS-MAX-BODY-UNUSED: P?: maxBodyBytes is typed but unused on the hot path",
] as const;
