/**
 * SUPERSEDED: B-SOC-CONSTRUCT characterization only.
 *
 * Former contract-freeze baseline asserted that `createClient({ auth: { oauth|social|socialProviders } })`
 * throws `ATHENA_AUTH_FEATURE_UNSUPPORTED`. Product now validates `auth.oauth` as an object
 * provider map (`auth.oauth must be an object provider map`), so the construct-time 501 is gone.
 *
 * Remaining Slice 01 contract-freeze tests stay GREEN in
 * `test/sdd/social-oauth-embedded-finality.contract-freeze.baseline.test.ts`.
 * Do not invert titles in place.
 *
 * Spec: docs/sdd/xylex/athena-social-oauth-embedded-finality/specs/01-contract-freeze.md
 *
 * Kept as a record only (not a *.test.ts file so CI does not run it).
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  AthenaConfigurationError,
  createClient,
} from "../../../src/v3-client.ts";

const SAMPLE_PG =
  "postgresql://postgres@127.0.0.1:5432/athena_social_oauth_baseline";

test("B-SOC-CONSTRUCT (superseded): v3-client oauth|social|socialProviders throws ATHENA_AUTH_FEATURE_UNSUPPORTED", () => {
  for (const auth of [
    { oauth: true },
    { social: true },
    { socialProviders: { google: { clientId: "x" } } },
  ] as const) {
    assert.throws(
      () =>
        createClient({
          auth: auth as never,
          databaseUrl: SAMPLE_PG,
          env: {},
        }),
      (error: unknown) =>
        error instanceof AthenaConfigurationError &&
        error.code === "ATHENA_AUTH_FEATURE_UNSUPPORTED" &&
        /oauth|social/i.test(error.message),
      `construct must reject ${JSON.stringify(auth)}`
    );
  }
});
