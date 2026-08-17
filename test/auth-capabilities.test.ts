import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  createAthenaAuthCapabilitiesStore,
  isCapabilityEnabled,
  isSocialCapabilityEnabled,
  resolveSocialProvidersForUi,
} from "../src/auth/capabilities.ts";
import { createAuthModule } from "../src/auth/client.ts";

test("unknown capabilities are not treated as disabled (INV-P)", () => {
  const store = createAthenaAuthCapabilitiesStore();
  const caps = store.get();
  assert.equal(caps.status, "unknown");
  assert.equal(isCapabilityEnabled(caps, "organizations"), false);
  // UI must not hide org chrome solely because lookup failed
  const social = resolveSocialProvidersForUi(caps);
  assert.equal(social.hide, false);
  assert.equal(social.providers, null);
});

test("markUnknown after known becomes partial and keeps feature hints", () => {
  const store = createAthenaAuthCapabilitiesStore();
  store.set({
    status: "known",
    source: "http",
    organizations: true,
    social: { providers: ["google"] },
  });
  const after = store.markUnknown("http");
  assert.equal(after.status, "partial");
  assert.equal(after.organizations, true);
  assert.deepEqual(after.social?.providers, ["google"]);
});

test("known false disables; known true enables", () => {
  const store = createAthenaAuthCapabilitiesStore({
    status: "known",
    source: "bootstrap",
    password: false,
    organizations: true,
  });
  const caps = store.get();
  assert.equal(isCapabilityEnabled(caps, "password"), false);
  assert.equal(isCapabilityEnabled(caps, "organizations"), true);
});

test("getSnapshot aliases get and does not invent a second owner", () => {
  const store = createAthenaAuthCapabilitiesStore({
    status: "known",
    source: "bootstrap",
    password: true,
  });
  assert.equal(store.getSnapshot, store.get);
  assert.equal(store.getSnapshot(), store.get());
  assert.equal(store.getSnapshot().password, true);
});

test("embedded 5.1 snapshot advertises password/session and hides social/passkeys", () => {
  const snap = ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT;
  assert.equal(snap.status, "known");
  assert.equal(snap.source, "bootstrap");
  assert.equal(snap.password, true);
  assert.equal(snap.emailAndPassword, true);
  assert.equal(snap.sessions, true);
  assert.equal(snap.organizations, true);
  assert.equal(snap.passkeys, false);
  assert.deepEqual(snap.social?.providers, []);
  assert.equal(isSocialCapabilityEnabled(snap), false);
  assert.equal(isCapabilityEnabled(snap, "passkeys"), false);
  assert.equal(isCapabilityEnabled(snap, "password"), true);
});

test("known-false social/passkeys fail closed on the public client", async () => {
  const auth = createAuthModule({
    capabilities: ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT,
  }).auth;
  assert.equal(auth.capabilities.getSnapshot, auth.capabilities.get);
  const snap = auth.capabilities.getSnapshot();
  assert.equal(snap.passkeys, false);
  assert.equal(isSocialCapabilityEnabled(snap), false);

  const social = await auth.signIn.social({
    provider: "google",
  } as never);
  assert.equal(social.ok, false);
  assert.equal(social.status, 501);
  assert.equal(social.errorDetails?.code, "ATHENA_AUTH_CAPABILITY_DISABLED");

  const passkey = await auth.passkey.generateRegisterOptions({});
  assert.equal(passkey.ok, false);
  assert.equal(passkey.errorDetails?.code, "ATHENA_AUTH_CAPABILITY_DISABLED");
});
