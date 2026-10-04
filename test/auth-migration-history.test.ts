import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { assertAuthMigrationManifestAppendOnly } from "../scripts/verify-auth-migration-history.mjs";

const ATHENA_570_033_CHECKSUM =
  "044557ff8b79810d05e43f4fb9f0203e42b68ad0ea9c62c4e1c1970440a6b764";
const CANONICAL_033_CHECKSUM =
  "483af951e47a72cdffb6b8a21f5878a1e9c2ce250079e7535bad35a47d5a1418";
const CHECKSUM_034 =
  "c1a4b64c48205a33c3a51e5c036655ff527e084072e75fce525a8760b31366a4";
const CHECKSUM_035 =
  "f32a9b74448cf01bcf1f6c9dbab21dc9cb5c7943d78cbc2403a87728c0ef52e6";

test("Auth migration history accepts appended versions and the one-time 5.7.0 correction", () => {
  assert.doesNotThrow(() =>
    assertAuthMigrationManifestAppendOnly(
      { "033": ATHENA_570_033_CHECKSUM, "034": CHECKSUM_034 },
      {
        "033": CANONICAL_033_CHECKSUM,
        "034": CHECKSUM_034,
        "035": CHECKSUM_035,
      },
      { packageVersion: "5.7.1" }
    )
  );
});

test("Auth migration history rejects edits, removals, and insertions before released versions", () => {
  const baseline = { "033": CANONICAL_033_CHECKSUM, "034": CHECKSUM_034 };

  assert.throws(
    () =>
      assertAuthMigrationManifestAppendOnly(
        baseline,
        { "033": CANONICAL_033_CHECKSUM, "034": CHECKSUM_035 },
        { packageVersion: "5.7.1" }
      ),
    /Released Auth migration 034 changed.*append-only/i
  );
  assert.throws(
    () =>
      assertAuthMigrationManifestAppendOnly(
        baseline,
        { "033": CANONICAL_033_CHECKSUM },
        { packageVersion: "5.7.1" }
      ),
    /Released Auth migration 034 was removed.*append-only/i
  );
  assert.throws(
    () =>
      assertAuthMigrationManifestAppendOnly(
        baseline,
        {
          "032": CHECKSUM_035,
          "033": CANONICAL_033_CHECKSUM,
          "034": CHECKSUM_034,
        },
        { packageVersion: "5.7.1" }
      ),
    /inserted before the end of released history/i
  );
});

test("the one-time 5.7.0 correction remains valid after an unpublished 5.7.1", () => {
  const baseline = { "033": ATHENA_570_033_CHECKSUM };
  assert.throws(
    () =>
      assertAuthMigrationManifestAppendOnly(
        baseline,
        { "033": ATHENA_570_033_CHECKSUM },
        { packageVersion: "5.7.1" }
    ),
    /migration 033 must retain canonical checksum/i
  );
  assert.doesNotThrow(
    () =>
      assertAuthMigrationManifestAppendOnly(
        baseline,
        { "033": CANONICAL_033_CHECKSUM },
        { packageVersion: "5.7.2" }
      )
  );
  assert.throws(
    () =>
      assertAuthMigrationManifestAppendOnly(
        { "033": CANONICAL_033_CHECKSUM, "034": CHECKSUM_034 },
        {
          "033": CANONICAL_033_CHECKSUM,
          "034": ATHENA_570_033_CHECKSUM,
        },
        { packageVersion: "5.7.1" }
      ),
    /Released Auth migration 034 changed.*append-only/i
  );
});
