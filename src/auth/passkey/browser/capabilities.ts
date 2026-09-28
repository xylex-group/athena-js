/**
 * Internal helper: backend passkeys capability vs browser WebAuthn presence.
 * High-level register()/signIn() live on athena.auth.passkey via ceremony.ts.
 */
export function inspectPasskeyBrowserCapabilities(input?: {
  backendPasskeys?: boolean | null;
}): {
  backendPasskeys: boolean;
  webAuthn: boolean;
} {
  const nav =
    typeof globalThis === "object"
      ? (globalThis as { navigator?: { credentials?: unknown } }).navigator
      : undefined;
  const hasPublicKey =
    typeof globalThis === "object" &&
    "PublicKeyCredential" in globalThis &&
    typeof (globalThis as { PublicKeyCredential?: unknown })
      .PublicKeyCredential !== "undefined";
  const hasWindow =
    typeof globalThis === "object" &&
    "window" in globalThis &&
    (globalThis as { window?: unknown }).window != null;

  return {
    backendPasskeys: input?.backendPasskeys === true,
    webAuthn: Boolean(hasWindow && nav?.credentials && hasPublicKey),
  };
}
