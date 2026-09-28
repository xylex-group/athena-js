/**
 * Baseline retired — transactional mail wiring inverted these asserts.
 * Superseded by test/email/email-transactional.target.test.ts
 */
import { test } from "node:test";

const SUPERSEDED =
  "superseded by target suite test/email/email-transactional.target.test.ts";

test("B-MAIL-HOOK-SOURCE: built-in flows still call ctx.email?.send", {
  skip: SUPERSEDED,
}, () => {});
test("B-MAIL-LIST: GET /email/list is missing on embedded", {
  skip: SUPERSEDED,
}, () => {});
test("B-MAIL-GET-RESET: GET /reset-password/{token} is missing", {
  skip: SUPERSEDED,
}, () => {});
