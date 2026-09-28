/**
 * Waves 2–14 target suite — Athena native passkey finality.
 * Host (never pnpm test:sdd):
 * node --import ./test/register-server-only.mjs --import tsx --test --test-force-exit --
 *   test/sdd/athena-native-passkey-finality.waves-2-14.target.test.ts
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createEmbeddedCapabilitySnapshot,
  isCapabilityEnabled,
  isPasskeyOnboardingEnabled,
} from "../../src/auth/capabilities.ts";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../../src/auth/contract/index.ts";
import type { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { toPasskeyView } from "../../src/auth/local/passkey/view.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { getAthenaAuthExpectedLedger } from "../../src/auth/local/schema.ts";
import { ATHENA_AUTH_MIGRATION_EXPECTATIONS } from "../../src/auth/local/schema-manifest.ts";
import { normalizePasskeyAaguid } from "../../src/auth/passkey/aaguid.ts";
import { resolvePasskeyAuthenticatorDisplay } from "../../src/auth/passkey/metadata/index.ts";
import {
  normalizePasskeyAuthenticationPolicy,
  normalizePasskeyRegistrationPolicy,
  requireUserVerificationFromPolicy,
} from "../../src/auth/passkey/policy.ts";
import type { AthenaStoredPasskey } from "../../src/auth/passkey/server/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");

function readPkg(rel: string): string {
  return readFileSync(join(pkgRoot, rel), "utf8");
}

test("T-NPK-GEN-26 (historical): ledger v25 AAGUID + v26 registration_transactions remain at generation 28", () => {
  // Generation 26 landed these ledger entries. Current generation is 29
  // (`029_notification_preferences`); v25/v26/v28 remain in history.
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION >= 28, true);
  const ledger = getAthenaAuthExpectedLedger();
  assert.ok(
    ledger.some(
      (entry) => entry.version === 25 && entry.name.includes("aaguid")
    )
  );
  assert.ok(
    ledger.some(
      (entry) =>
        entry.version === 26 && entry.name.includes("registration_transactions")
    )
  );
  assert.ok(
    ATHENA_AUTH_MIGRATION_EXPECTATIONS[25]?.some(
      (item) => item.object === "athena.passkeys.aaguid"
    )
  );
});

test("T-NPK-AAGUID: only verified UUID-style AAGUIDs persist; unspecified is null", () => {
  assert.equal(
    normalizePasskeyAaguid("EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4"),
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4"
  );
  assert.equal(
    normalizePasskeyAaguid("00000000-0000-0000-0000-000000000000"),
    null
  );
  assert.equal(normalizePasskeyAaguid(new Uint8Array(16)), null);
  assert.equal(normalizePasskeyAaguid("not-an-aaguid"), null);
});

test("T-NPK-DISPLAY: never show AAGUID, credential id, or database id as the title", () => {
  const known = resolvePasskeyAuthenticatorDisplay({
    aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
  });
  assert.equal(known.displayName, "Google Password Manager");
  assert.equal(known.vendor, "Google");

  const named = resolvePasskeyAuthenticatorDisplay({
    aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
    name: "Travel YubiKey",
  });
  assert.equal(named.displayName, "Travel YubiKey");

  const uuidName = resolvePasskeyAuthenticatorDisplay({
    aaguid: null,
    name: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    transports: ["usb"],
  });
  assert.equal(uuidName.displayName, "Security key");
  assert.equal(uuidName.displayName.includes("aaaa"), false);
});

test("T-NPK-POLICY: unspecified fields do not tighten SimpleWebAuthn defaults", () => {
  const registration = normalizePasskeyRegistrationPolicy(undefined);
  assert.equal(registration.userVerification, null);
  assert.equal(registration.residentKey, null);
  assert.equal(registration.authenticatorAttachment, null);
  assert.equal(requireUserVerificationFromPolicy(null), false);
  assert.equal(requireUserVerificationFromPolicy("preferred"), false);
  assert.equal(requireUserVerificationFromPolicy("required"), true);

  const configured = normalizePasskeyRegistrationPolicy({
    extensions: { credProps: true, largeBlob: true },
    userVerification: "required",
  });
  assert.equal(configured.userVerification, "required");
  assert.deepEqual(configured.extensions, { credProps: true });

  const authPolicy = normalizePasskeyAuthenticationPolicy({
    userVerification: "preferred",
  });
  assert.equal(authPolicy.userVerification, "preferred");
});

test("T-NPK-CONFIG: createClient passkey policy normalizes without a second client", () => {
  const config = normalizeAthenaAuthConfig({
    mode: "local",
    passkey: {
      enabled: true,
      origins: ["https://example.com"],
      registration: {
        extensions: { credProps: true },
        residentKey: "preferred",
        userVerification: "preferred",
      },
      rpId: "example.com",
      rpName: "Example",
    },
  });
  assert.equal(config.passkey.enabled, true);
  assert.equal(config.passkey.registration.userVerification, "preferred");
  assert.equal(config.passkey.onboardingEnabled, false);
  assert.equal(config.passkey.authentication.userVerification, null);
});

test("T-NPK-DTO: public view has authenticator metadata and no secrets", () => {
  const stored: AthenaStoredPasskey = {
    aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
    backedUp: true,
    counter: 0n,
    createdAt: new Date("2026-08-22T00:00:00.000Z"),
    credentialId: new Uint8Array([1, 2, 3, 4]),
    deviceType: "multiDevice",
    id: "pk_1",
    name: null,
    publicKey: new Uint8Array([9, 9, 9]),
    residentKey: true,
    transports: ["internal", "hybrid"],
    updatedAt: null,
    userId: "user_1",
  };
  const view = toPasskeyView(stored);
  assert.equal(view.id, "pk_1");
  assert.equal(view.name, null);
  assert.equal(view.authenticator.displayName, "Google Password Manager");
  assert.equal(view.authenticator.vendor, "Google");
  assert.equal(view.authenticator.backedUp, true);
  assert.equal(view.authenticator.residentKey, true);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("publicKey"), false);
  assert.equal(serialized.includes("credentialID"), false);
  assert.equal(serialized.includes("ea9b8d66"), false);
});

test("T-NPK-CAP: onboarding is additive detail, never inferred from passkeys true", () => {
  const enabled = createEmbeddedCapabilitySnapshot({ passkeyEnabled: true });
  assert.equal(isCapabilityEnabled(enabled, "passkeys"), true);
  assert.equal(isPasskeyOnboardingEnabled(enabled), false);
  assert.equal(enabled.passkey?.onboarding, false);

  const onboarding = createEmbeddedCapabilitySnapshot({
    passkeyEnabled: true,
    passkeyOnboarding: true,
  });
  assert.equal(isPasskeyOnboardingEnabled(onboarding), true);

  const unknown = {
    ...enabled,
    status: "unknown" as const,
  };
  assert.equal(isPasskeyOnboardingEnabled(unknown), false);
});

test("T-NPK-ONBOARD-ABANDON: generate-register-options without session does not create a user", async () => {
  const runtime = createAthenaAuthRuntime({
    config: normalizeAthenaAuthConfig({
      mode: "local",
      passkey: {
        enabled: true,
        onboarding: { enabled: true },
        origins: ["http://app.local"],
        rpId: "app.example.com",
        rpName: "Example",
      },
      secret: "test-secret",
    }),
    secret: "test-secret",
  });
  const response = await runtime.handle(
    new Request(
      "http://app.local/api/auth/passkey/generate-register-options?email=a@b.co",
      {
        headers: { Origin: "http://app.local" },
        method: "GET",
      }
    )
  );
  assert.equal(response.status, 200);
  const stores = (await runtime.getStores()) as MemoryAuthStores;
  assert.equal(stores.users.size, 0);
  await runtime.close();
});

test("T-NPK-ONBOARD-OFF: unauthenticated register stays 401 when onboarding is disabled", async () => {
  const runtime = createAthenaAuthRuntime({
    config: normalizeAthenaAuthConfig({
      mode: "local",
      passkey: {
        enabled: true,
        origins: ["http://app.local"],
        rpId: "app.example.com",
        rpName: "Example",
      },
      secret: "test-secret",
    }),
    secret: "test-secret",
  });
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/passkey/generate-register-options", {
      headers: { Origin: "http://app.local" },
      method: "GET",
    })
  );
  assert.equal(response.status, 401);
  await runtime.close();
});

test("T-NPK-BROWSER: browser entry does not import server-only passkey engines", () => {
  const browser = readPkg("src/browser.ts");
  assert.equal(browser.includes("node:async_hooks"), false);
  assert.equal(browser.includes("@simplewebauthn/server"), false);
  assert.equal(browser.includes("createPostgresAuthDatabase"), false);
  assert.match(browser, /isPasskeyOnboardingEnabled/);
  assert.match(browser, /isCapabilityEnabled/);
  const index = readPkg("src/index.ts");
  assert.match(index, /createClient/);
});

test("T-NPK-NO-CLIENT: still no createPasskeyClient", () => {
  const assembly = readPkg("src/auth/client.ts") + readPkg("src/v3-client.ts");
  assert.equal(assembly.includes("createPasskeyClient"), false);
});
