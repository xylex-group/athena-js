# Athena api Client Bindings

This page documents the auth surface exposed on `createClient(...).auth` in `athena-js`, including Better Auth-style grouped methods and React `useSession` parity.

For per-domain deep docs (with endpoint-by-endpoint TypeScript examples), see [`docs/auth/index.mdx`](./auth/index.mdx).

All calls return the auth envelope:

```ts
type AthenaAuthResult<T> = {
  ok: boolean
  status: number
  data: T | null
  error: string | null
  errorDetails?: AthenaAuthErrorDetails | null
  raw: unknown
}
```

## Client setup

```ts
import { createClient } from "@xylex-group/athena"

const client = createClient("http://localhost:3001", "gateway_api_key", {
  auth: { baseUrl: "http://localhost:3001/api/auth" },
})
```

`client.auth.*` is the auth-server client surface. It does not automatically make `from(...)`, `rpc(...)`, or `query(...)` session-aware on its own.

If you want normal gateway/query requests to carry Athena Auth session or bearer context for server-side auth rollout, see [`auth-session-forwarding.md`](./auth-session-forwarding.md).

## Method map (`client.auth.*`)

### Session-level bindings

- `client.auth.getSession()` -> `GET /get-session`
- `client.auth.signOut()` -> `POST /sign-out`

### Session user bindings

- `client.auth.forgetPassword()` -> `POST /forget-password`
- `client.auth.resetPassword()` -> `POST /reset-password`
- `client.auth.resetPassword.token()` -> `GET /reset-password/{token}`
- `client.auth.setPassword()` -> `POST /set-password`
- `client.auth.verifyEmail()` -> `GET /verify-email`
- `client.auth.sendVerificationEmail()` -> `POST /send-verification-email`
- `client.auth.changeEmail()` -> `POST /change-email`
- `client.auth.changeEmailVerify()` -> `GET /change-email/verify`
- `client.auth.deleteUserVerify()` -> `GET /delete-user/verify`
- `client.auth.changePassword()` -> `POST /change-password`
- `client.auth.user.update()` -> `POST /update-user`
- `client.auth.user.delete()` -> `POST /delete-user`
- `client.auth.user.email.list()` -> `GET /email/list` (fallback to `GET /email-list` on `404`)

### Session bindings

- `client.auth.session.list()` -> `GET /list-sessions`
- `client.auth.session.revokeOther()` -> `POST /revoke-other-sessions`
- `client.auth.session.revoke()` collapses by payload shape:
  - single token payload (or array length `1`) -> `POST /revoke-session`
  - multiple tokens payload -> `POST /revoke-sessions`

### Social / OAuth2 account bindings

- `client.auth.social.link()` -> `POST /link-social`
- `client.auth.account.list()` -> `GET /list-accounts`
- `client.auth.account.unlink()` -> `POST /unlink-account`
- `client.auth.deleteUser.callback()` -> `GET /delete-user/callback`
- `client.auth.refreshToken()` -> `POST /refresh-token`
- `client.auth.getAccessToken()` -> `POST /get-access-token`
- `client.auth.health()` -> `GET /health` (fallback to `GET /ok` on `404`)
- `client.auth.ok()` -> `GET /ok`
- `client.auth.error()` -> `GET /error`

### Two-factor bindings

- `client.auth.twoFactor.getTotpUri()` -> `POST /two-factor/get-totp-uri`
- `client.auth.twoFactor.verifyTotp()` -> `POST /two-factor/verify-totp`
- `client.auth.twoFactor.sendOtp()` -> `POST /two-factor/send-otp`
- `client.auth.twoFactor.verifyOtp()` -> `POST /two-factor/verify-otp`
- `client.auth.twoFactor.verifyBackupCode()` -> `POST /two-factor/verify-backup-code`
- `client.auth.twoFactor.generateBackupCodes()` -> `POST /two-factor/generate-backup-codes`
- `client.auth.twoFactor.enable()` -> `POST /two-factor/enable`
- `client.auth.twoFactor.disable()` -> `POST /two-factor/disable`

### Passkey bindings

- `client.auth.passkey.generateRegisterOptions()` -> `GET /passkey/generate-register-options`
- `client.auth.passkey.generateAuthenticateOptions()` -> `POST /passkey/generate-authenticate-options`
- `client.auth.passkey.verifyRegistration()` -> `POST /passkey/verify-registration`
- `client.auth.passkey.verifyAuthentication()` -> `POST /passkey/verify-authentication`
- `client.auth.passkey.listUserPasskeys()` -> `GET /passkey/list-user-passkeys`
- `client.auth.passkey.deletePasskey()` -> `POST /passkey/delete-passkey`
- `client.auth.passkey.updatePasskey()` -> `POST /passkey/update-passkey`
- `client.auth.passkey.getRelatedOrigins()` -> `GET /.well-known/webauthn`

### Admin bindings

All admin endpoints are server-authorized; the server enforces role/permission checks.

- `client.auth.admin.role.set()` -> `POST /admin/set-role`
- `client.auth.admin.user.list()` -> `GET /admin/list-users`
- `client.auth.admin.user.session.list()` -> `POST /admin/list-user-sessions`
- `client.auth.admin.user.create()` -> `POST /admin/create-user`
- `client.auth.admin.user.unban()` -> `POST /admin/unban-user`
- `client.auth.admin.user.ban()` -> `POST /admin/ban-user`
- `client.auth.admin.user.impersonate()` -> `POST /admin/impersonate-user`
- `client.auth.admin.user.stopImpersonating()` -> `POST /admin/stop-impersonating`
- `client.auth.admin.user.session.revoke()` collapses by payload shape:
  - single payload (or array length `1`) -> `POST /admin/revoke-user-session`
  - multiple payloads -> `POST /admin/revoke-user-sessions` (requires one shared `userId`)
- `client.auth.admin.user.remove()` -> `POST /admin/remove-user`
- `client.auth.admin.user.setPassword()` -> `POST /admin/set-user-password`
- `client.auth.admin.hasPermission()` -> `POST /admin/has-permission`
- `client.auth.admin.apiKey.create()` -> `POST /admin/api-key/create`
- `client.auth.admin.athenaClient.create()` -> `POST /admin/athena-client/create`
- `client.auth.admin.athenaClient.list()` -> `GET /admin/athena-client/list`
- `client.auth.admin.auditLog.list()` -> `GET /admin/audit-log/list`
- `client.auth.admin.email.list()` -> `GET /admin/email/list`
- `client.auth.admin.email.get()` -> `GET /admin/email/get`
- `client.auth.admin.email.create()` -> `POST /admin/email/create`
- `client.auth.admin.email.update()` -> `POST /admin/email/update`
- `client.auth.admin.email.delete()` -> `POST /admin/email/delete`
- `client.auth.admin.email.failure.list()` -> `GET /admin/email-failure/list`
- `client.auth.admin.email.failure.get()` -> `GET /admin/email-failure/get`
- `client.auth.admin.email.failure.create()` -> `POST /admin/email-failure/create`
- `client.auth.admin.email.failure.update()` -> `POST /admin/email-failure/update`
- `client.auth.admin.email.failure.delete()` -> `POST /admin/email-failure/delete`
- `client.auth.admin.email.template.list()` -> `GET /admin/email-template/list`
- `client.auth.admin.email.template.get()` -> `GET /admin/email-template/get`
- `client.auth.admin.email.template.create()` -> `POST /admin/email-template/create`
- `client.auth.admin.email.template.update()` -> `POST /admin/email-template/update`
- `client.auth.admin.email.template.delete()` -> `POST /admin/email-template/delete`
- `client.auth.admin.emailTemplate.list()` -> `GET /admin/email-template/list` (legacy alias)
- `client.auth.admin.emailTemplate.get()` -> `GET /admin/email-template/get` (legacy alias)
- `client.auth.admin.emailTemplate.create()` -> `POST /admin/email-template/create` (legacy alias)
- `client.auth.admin.emailTemplate.update()` -> `POST /admin/email-template/update` (legacy alias)
- `client.auth.admin.emailTemplate.delete()` -> `POST /admin/email-template/delete` (legacy alias)

### API key bindings

- `client.auth.apiKey.create()` -> `POST /api-key/create`
- `client.auth.apiKey.get()` -> `GET /api-key/get`
- `client.auth.apiKey.update()` -> `POST /api-key/update`
- `client.auth.apiKey.delete()` -> `POST /api-key/delete`
- `client.auth.apiKey.list()` -> `GET /api-key/list`
- `client.auth.apiKey.verify()` -> `POST /api-key/verify`
- `client.auth.apiKey.deleteAllExpired()` -> `POST /api-key/delete-all-expired-api-keys`

### Sign in / sign up bindings

- `client.auth.signIn.social()` -> `POST /sign-in/social`
- `client.auth.signIn.email()` -> `POST /sign-in/email`
- `client.auth.signIn.username()` -> `POST /sign-in/username`
- `client.auth.signUp.email()` -> `POST /sign-up/email`

### Organization bindings

- `client.auth.organization.create()` -> `POST /organization/create`
- `client.auth.organization.update()` -> `POST /organization/update`
- `client.auth.organization.delete()` -> `POST /organization/delete`
- `client.auth.organization.setActive()` -> `POST /organization/set-active`
- `client.auth.organization.list()` -> `GET /organization/list`
- `client.auth.organization.getFull()` -> `GET /organization/get-full-organization`
- `client.auth.organization.invitation.cancel()` -> `POST /organization/cancel-invitation`
- `client.auth.organization.invitation.accept()` -> `POST /organization/accept-invitation`
- `client.auth.organization.invitation.get()` -> `GET /organization/get-invitation`
- `client.auth.organization.invitation.reject()` -> `POST /organization/reject-invitation`
- `client.auth.organization.checkSlug()` -> `POST /organization/check-slug`
- `client.auth.organization.member.remove()` -> `POST /organization/remove-member`
- `client.auth.organization.member.updateRole()` -> `POST /organization/update-member-role`
- `client.auth.organization.member.invite()` -> `POST /organization/invite-member`
- `client.auth.organization.member.getActive()` -> `GET /organization/get-active-member`
- `client.auth.organization.member.list()` -> `GET /organization/list-members`
- `client.auth.organization.leave()` -> `POST /organization/leave`
- `client.auth.organization.invitation.list()` -> `GET /organization/list-invitations`
- `client.auth.organization.listUserInvitations()` -> `GET /organization/list-user-invitations`
- `client.auth.organization.hasPermission()` -> `POST /organization/has-permission`

### Storage bindings

#### Managed file/catalog bindings

- `client.storage.credentials.list()` -> `GET /storage/credentials`
- `client.storage.catalog.list()` -> `GET /storage/catalogs`
- `client.storage.catalog.create()` -> `POST /storage/catalogs`
- `client.storage.catalog.update()` -> `PATCH /storage/catalogs/{id}`
- `client.storage.catalog.delete()` -> `DELETE /storage/catalogs/{id}`

- `client.storage.file.upload()` -> `POST /storage/files/upload-url`
- `client.storage.file.uploadMany()` -> `POST /storage/files/upload-urls`
- `client.storage.file.list()` -> `POST /storage/files/list`
- `client.storage.file.get()` -> `GET /storage/files/{file_id}`
- `client.storage.file.update()` -> `PATCH /storage/files/{file_id}`
- `client.storage.file.delete()` -> `DELETE /storage/files/{file_id}`
- `client.storage.file.url()` -> `GET /storage/files/{file_id}/url`
- `client.storage.file.proxy()` -> `GET /storage/files/{file_id}/proxy`
- `client.storage.file.visibility.update()` -> `PATCH /storage/files/{file_id}/visibility`
- `client.storage.file.visibility.set()` -> `POST /storage/files/{file_id}/visibility`

- `client.storage.folder.delete()` -> `POST /storage/folders/delete`
- `client.storage.folder.move()` -> `POST /storage/folders/move`

#### Raw S3-compatible object bindings

- `client.storage.object.list()` -> `POST /storage/objects`
- `client.storage.object.head()` -> `POST /storage/objects/head`
- `client.storage.object.update()` -> `POST /storage/objects/update`
- `client.storage.object.url()` -> `POST /storage/objects/url`
- `client.storage.object.delete()` -> `POST /storage/objects/delete`
- `client.storage.object.uploadUrl()` -> `POST /storage/objects/upload-url`

- `client.storage.object.folder.create()` -> `POST /storage/objects/folder`
- `client.storage.object.folder.delete()` -> `POST /storage/objects/folder/delete`
- `client.storage.object.folder.rename()` -> `POST /storage/objects/folder/rename`

#### Bucket bindings

- `client.storage.bucket.list()` -> `POST /storage/buckets/list`
- `client.storage.bucket.create()` -> `POST /storage/buckets/create`
- `client.storage.bucket.delete()` -> `POST /storage/buckets/delete`
- `client.storage.bucket.cors.get()` -> `POST /storage/buckets/cors`
- `client.storage.bucket.cors.set()` -> `POST /storage/buckets/cors/set`
- `client.storage.bucket.cors.delete()` -> `POST /storage/buckets/cors/delete`

### Missing storage API coverage

- Direct binary upload endpoint, e.g. `PUT/POST /storage/files/{file_id}/upload` or multipart upload support. Current flow only returns presigned upload URLs.
- Multipart uploads: create multipart upload, sign part URLs, complete multipart upload, abort multipart upload, list uploaded parts.
- Copy single file/object endpoint. Rename/move exists for managed files and folders, but explicit copy/duplicate is missing.
- Batch delete files by IDs.
- Batch update metadata/visibility.
- File permission endpoints: grant/revoke/list access for user, organization, team, role.
- Public URL endpoint that returns Athena proxy URL or public route, not only presigned S3 URLs.
- Download/proxy range support contract for video/audio streaming, including `Range` headers.
- File search endpoint by metadata/name/resource_id/mime/status, not only prefix listing.
- Pagination for managed file list: `limit`, `cursor`/`offset`.
- Folder listing/tree endpoint returning folders + files, not only file rows under prefix.
- Confirm-upload/finalize endpoint to mark uploaded files as complete after PUT succeeds.
- Object existence/checksum validation endpoint.
- Soft-delete restore endpoint.
- Permanent purge endpoint.
- Versioning support: list versions, restore version, delete version.
- Lifecycle/retention APIs.
- Bucket policy/public access APIs.
- Signed POST policy support for browser uploads.
- Server-side encryption options.
- Audit/event listing endpoints for storage operations.


### OAuth callback bindings

- `client.auth.callback.provider({ provider, code, state })` -> `GET /callback/{provider}?code=...&state=...`

## React `useSession` parity

`athena-js` now exports `useSession` from `@xylex-group/athena/react`.

```ts
import { useSession } from "@xylex-group/athena/react"
import { createClient } from "@xylex-group/athena"

const client = createClient("http://localhost:3001", "gateway_api_key", {
  auth: { baseUrl: "http://localhost:3001/api/auth" },
})

function SessionPanel() {
  const { data, isPending, isRefetching, error, refetch } = useSession(client)
  return null
}
```

`useSession` return shape:

- `data`: session payload or `null`
- `isPending`: initial loading state
- `isRefetching`: true during background/manual refresh when session already exists
- `error`: normalized auth error details
- `refetch()`: re-runs `getSession`

## Legacy flat methods remain

Top-level methods (`client.getSession`, `client.signOut`, `client.signIn.email`, etc.) are still available on the deprecated `createAuthClient(...)` return type for backward compatibility.

## Deprecated helper

`createAuthClient(...)` still exists for backward compatibility, but it is deprecated in favor of `createClient(...).auth`.
