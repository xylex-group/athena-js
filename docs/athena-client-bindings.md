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

const client = createClient({
  key: "gateway_api_key",
  auth: { url: "http://localhost:3001/api/auth" },
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
- `client.auth.admin.email.template.send()` -> `POST /admin/email-template/send`
- `client.auth.admin.email.eventType.list()` -> `GET /admin/email-event-type/list`
- `client.auth.admin.emailTemplate.list()` -> `GET /admin/email-template/list` (legacy alias)
- `client.auth.admin.emailTemplate.get()` -> `GET /admin/email-template/get` (legacy alias)
- `client.auth.admin.emailTemplate.create()` -> `POST /admin/email-template/create` (legacy alias)
- `client.auth.admin.emailTemplate.update()` -> `POST /admin/email-template/update` (legacy alias)
- `client.auth.admin.emailTemplate.delete()` -> `POST /admin/email-template/delete` (legacy alias)
- `client.auth.admin.emailTemplate.send()` -> `POST /admin/email-template/send` (legacy alias)
- `client.auth.admin.emailEventType.list()` -> `GET /admin/email-event-type/list` (legacy alias)

Canonical admin email-template payloads are now snake_case on the normalized surface:

- `template_key`
- `event_type`
- `subject_template`
- `text_template`
- `html_template`
- `variable_bindings`
- `attachments`
- `attachment_failure_mode`
- `is_active`

Legacy camelCase request aliases such as `templateKey`, `eventType`, `subjectTemplate`, `variableBindings`, and `attachmentFailureMode` are still accepted for compatibility.

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

Route SSOT: `storageSdkManifest` METHOD+path entries match
`contracts/storage/live-http-routes.json` (and the JS mirror
`src/storage/live-http-routes.json`) exactly. Thin JSON helpers resolve
path/method/envelope via `requireStorageManifestRoute` so wrappers cannot
drift. Dual visibility (`PATCH` + `POST`), binary proxy/upload, and admin
backup routes remain specialized.

#### Managed file/catalog bindings

- `client.storage.listStorageCatalogs()` -> `GET /storage/catalogs`
- `client.storage.createStorageCatalog()` -> `POST /storage/catalogs`
- `client.storage.updateStorageCatalog()` -> `PATCH /storage/catalogs/{id}`
- `client.storage.deleteStorageCatalog()` -> `DELETE /storage/catalogs/{id}`
- `client.storage.listStorageCredentials()` -> `GET /storage/credentials`

- `client.storage.createStorageUploadUrl()` -> `POST /storage/files/upload-url`
- `client.storage.createStorageUploadUrls()` -> `POST /storage/files/upload-urls`
- `client.storage.listStorageFiles()` -> `POST /storage/files/list`
- `client.storage.getStorageFile()` -> `GET /storage/files/{file_id}`
- `client.storage.updateStorageFile()` -> `PATCH /storage/files/{file_id}`
- `client.storage.deleteStorageFile()` -> `DELETE /storage/files/{file_id}`
- `client.storage.getStorageFileUrl()` -> `GET /storage/files/{file_id}/url`
- `client.storage.getStorageFileProxy()` -> `GET /storage/files/{file_id}/proxy`
- `client.storage.setStorageFileVisibility()` -> `PATCH /storage/files/{file_id}/visibility`
- `client.storage.deleteStorageFolder()` -> `POST /storage/folders/delete`
- `client.storage.moveStorageFolder()` -> `POST /storage/folders/move`

- `client.storage.file.upload()` -> `POST /storage/files/upload-url` or `POST /storage/files/upload-urls`, followed by presigned `PUT`
- `client.storage.file.uploadMany()` -> `POST /storage/files/upload-urls`
- `client.storage.file.confirmUpload()` -> `POST /storage/files/{file_id}/confirm-upload`
- `client.storage.file.uploadBinary()` -> `PUT /storage/files/{file_id}/upload`
- `client.storage.file.search()` -> `POST /storage/files/search`
- `client.storage.file.get()` -> `GET /storage/files/{file_id}`
- `client.storage.file.update()` -> `PATCH /storage/files/{file_id}`
- `client.storage.file.delete()` -> `DELETE /storage/files/{file_id}`
- `client.storage.file.deleteMany()` -> `POST /storage/files/delete-many`
- `client.storage.file.updateMany()` -> `POST /storage/files/update-many`
- `client.storage.file.restore()` -> `POST /storage/files/{file_id}/restore`
- `client.storage.file.purge()` -> `DELETE /storage/files/{file_id}/purge`
- `client.storage.file.copy()` -> `POST /storage/files/{file_id}/copy`
- `client.storage.file.url()` -> `GET /storage/files/{file_id}/url`
- `client.storage.file.publicUrl()` -> `GET /storage/files/{file_id}/public-url`
- `client.storage.file.proxyUrl()` -> `GET /storage/files/{file_id}/proxy-url`
- `client.storage.file.proxy()` -> `GET /storage/files/{file_id}/proxy`
- `client.storage.file.versions()` -> `GET /storage/files/{file_id}/versions`
- `client.storage.file.restoreVersion()` -> `POST /storage/files/{file_id}/versions/{version_id}/restore`
- `client.storage.file.deleteVersion()` -> `DELETE /storage/files/{file_id}/versions/{version_id}`
- `client.storage.file.retention.get()` -> `GET /storage/files/{file_id}/retention`
- `client.storage.file.retention.set()` -> `POST /storage/files/{file_id}/retention`
- `client.storage.file.visibility.update()` -> `PATCH /storage/files/{file_id}/visibility`
- `client.storage.file.visibility.set()` -> `POST /storage/files/{file_id}/visibility`
- `client.storage.file.visibility.setMany()` -> `POST /storage/files/visibility-many`

- `client.storage.folder.list()` -> `POST /storage/folders/list`
- `client.storage.folder.tree()` -> `POST /storage/folders/tree`
- `client.storage.folder.delete()` -> `POST /storage/folders/delete`
- `client.storage.folder.move()` -> `POST /storage/folders/move`

- `client.storage.permission.list()` -> `POST /storage/permissions/list`
- `client.storage.permission.grant()` -> `POST /storage/permissions/grant`
- `client.storage.permission.revoke()` -> `POST /storage/permissions/revoke`
- `client.storage.permission.check()` -> `POST /storage/permissions/check`

#### Raw S3-compatible object bindings

- `client.storage.object.list()` -> `POST /storage/objects`
- `client.storage.object.head()` -> `POST /storage/objects/head`
- `client.storage.object.exists()` -> `POST /storage/objects/exists`
- `client.storage.object.validate()` -> `POST /storage/objects/validate`
- `client.storage.object.update()` -> `POST /storage/objects/update`
- `client.storage.object.copy()` -> `POST /storage/objects/copy`
- `client.storage.object.url()` -> `POST /storage/objects/url`
- `client.storage.object.publicUrl()` -> `POST /storage/objects/public-url`
- `client.storage.object.delete()` -> `POST /storage/objects/delete`
- `client.storage.object.uploadUrl()` -> `POST /storage/objects/upload-url`
- `client.storage.object.postPolicy()` -> `POST /storage/objects/post-policy`
- `client.storage.object.versions()` -> `POST /storage/objects/versions`
- `client.storage.object.restoreVersion()` -> `POST /storage/objects/versions/restore`
- `client.storage.object.deleteVersion()` -> `POST /storage/objects/versions/delete`

- `client.storage.object.folder.create()` -> `POST /storage/objects/folder`
- `client.storage.object.folder.delete()` -> `POST /storage/objects/folder/delete`
- `client.storage.object.folder.rename()` -> `POST /storage/objects/folder/rename`

#### Bucket bindings

- `client.storage.bucket.list()` -> `POST /storage/buckets/list`
- `client.storage.bucket.create()` -> `POST /storage/buckets/create`
- `client.storage.bucket.delete()` -> `POST /storage/buckets/delete`
- `client.storage.bucket.lifecycle.get()` -> `POST /storage/buckets/lifecycle`
- `client.storage.bucket.lifecycle.set()` -> `POST /storage/buckets/lifecycle/set`
- `client.storage.bucket.lifecycle.delete()` -> `POST /storage/buckets/lifecycle/delete`
- `client.storage.bucket.policy.get()` -> `POST /storage/buckets/policy`
- `client.storage.bucket.policy.set()` -> `POST /storage/buckets/policy/set`
- `client.storage.bucket.policy.delete()` -> `POST /storage/buckets/policy/delete`
- `client.storage.bucket.publicAccess.get()` -> `POST /storage/buckets/public-access`
- `client.storage.bucket.publicAccess.set()` -> `POST /storage/buckets/public-access/set`
- `client.storage.bucket.publicAccess.delete()` -> `POST /storage/buckets/public-access/delete`
- `client.storage.bucket.cors.get()` -> `POST /storage/buckets/cors`
- `client.storage.bucket.cors.set()` -> `POST /storage/buckets/cors/set`
- `client.storage.bucket.cors.delete()` -> `POST /storage/buckets/cors/delete`

- `client.storage.multipart.create()` -> `POST /storage/multipart/create`
- `client.storage.multipart.signPart()` -> `POST /storage/multipart/sign-part`
- `client.storage.multipart.complete()` -> `POST /storage/multipart/complete`
- `client.storage.multipart.abort()` -> `POST /storage/multipart/abort`
- `client.storage.multipart.listParts()` -> `POST /storage/multipart/list-parts`

- `client.storage.audit.list()` -> `POST /storage/audit/list`


### OAuth callback bindings

- `client.auth.callback.provider({ provider, code, state })` -> `GET /callback/{provider}?code=...&state=...`

## React `useSession` parity

`athena-js` now exports `useSession` from `@xylex-group/athena/react`.

```ts
import { useSession } from "@xylex-group/athena/react"
import { createClient } from "@xylex-group/athena"

const client = createClient({
  key: "gateway_api_key",
  auth: { url: "http://localhost:3001/api/auth" },
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

Athena JS 3 exposes auth only through the stable `client.auth` namespace. There is no second auth-client constructor or legacy flat-method client.
