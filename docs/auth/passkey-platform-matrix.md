# Passkey platform matrix (manual)

Packed Chromium virtual-authenticator proof is the automated WebAuthn
closure (`packages/athena-auth-ui/e2e/tests/passkey-browser-finality.e2e.ts`
plus `packages/athena-js/test/finality/next-minimal-golden-passkey.test.ts`
for RP + first-paint capability). Do **not** block `@xylex-group/athena`
release on physical authenticators.

| Platform | Authenticator | Status | Notes |
| --- | --- | --- | --- |
| Chromium (CI / packed) | Virtual authenticator (CDP) | Automated | Registration → authentication → session |
| Windows | Windows Hello | Manual | Confirm `APP_URL` hostname matches the browser host |
| macOS | Touch ID / iCloud Keychain | Manual | Same origin as `APP_URL`; related origins if needed |
| iOS Safari | Passkeys | Manual | HTTPS public origin; not localhost |
| Android Chrome | Play services passkeys | Manual | HTTPS public origin |

Ordinary apps must not set `rpId`, `trustedOrigins`, a passkey origin
builder, WebAuthn serialization helpers, or capability polling. RP comes
from `APP_URL` / `app.url` with `auth.passkey.onboarding: true`.
