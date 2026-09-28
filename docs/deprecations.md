# Deprecations and 6.0.0 sunset

This page is the package-owned list of public Athena JS APIs that are
deprecated or scheduled for removal in the next major version.

## `athena.query()`

**Status:** Deprecated in Athena 5.x. Removal target: Athena 6.0.0.

The root raw-SQL compatibility alias will be removed in Athena 6.0.0. Migrate
to one of these supported query surfaces:

- Use `athena.admin.query()` when the SQL operation and expected result shape
  should be explicit:

  ```ts
  await athena.admin.query({
    sql: "select id from users where active = $1",
    params: [true],
    operation: "select",
    expectedShape: "rows",
  });
  ```

- Use `athena.db.query(sql, options)` when the compatibility
  `AthenaResult<Row[]>` shape and call signature are required.

When the configured environment is development or test, calling `athena.query()`
emits one warning per client:

> `athena.query()` is deprecated and will be removed in Athena 6.0.0. Use
> `athena.admin.query({ sql, operation, expectedShape })` or
> `athena.db.query(sql, options)` instead.

The warning is development-only by default; production and unknown environments
remain quiet. Set `diagnostics: true` to opt in explicitly.

## Flat auth account aliases

**Status:** Deprecated in Athena 5.x. Removal target: Athena 6.0.0.

These Better Auth-compatible flat aliases remain available during the 5.x
compatibility window:

- `athena.auth.listAccounts()` → `athena.auth.account.list()`
- `athena.auth.unlinkAccount()` → `athena.auth.account.unlink()`

In development, each alias emits one warning per client. Use the nested
account namespace for new code.

## Passkey method aliases

**Status:** Deprecated in Athena 5.x. Removal target: Athena 6.0.0.

Use the shorter passkey methods:

- `athena.auth.passkey.listUser()` replaces `athena.auth.passkey.listUserPasskeys()`
- `athena.auth.passkey.update()` replaces `athena.auth.passkey.updatePasskey()`
- `athena.auth.passkey.delete()` replaces `athena.auth.passkey.deletePasskey()`

The verbose methods remain available during the 5.x compatibility window. In
development, each emits one warning per client; production logs remain quiet.

## Auth email and user-delete aliases

**Status:** Deprecated in Athena 5.x. Removal target: Athena 6.0.0.

Use the grouped auth namespaces:

- `athena.auth.verificationEmail.send()` replaces
  `athena.auth.sendVerificationEmail()`
- `athena.auth.verificationEmail.verify()` replaces
  `athena.auth.verifyEmail()`
- `athena.auth.email.change()` replaces `athena.auth.changeEmail()`
- `athena.auth.email.change.verify()` replaces
  `athena.auth.changeEmailVerify()`
- `athena.auth.user.delete.verify()` replaces
  `athena.auth.deleteUserVerify()`
- `athena.auth.user.delete.callback()` replaces
  `athena.auth.deleteUser.callback()`

The existing methods remain available during the 5.x compatibility window. In
development, each emits one warning per client; production logs remain quiet.

## Auth session aliases

**Status:** Deprecated in Athena 5.x. Removal target: Athena 6.0.0.

Use the grouped session namespace:

- `athena.auth.session.list()` replaces `athena.auth.listSessions()`
- `athena.auth.session.revoke()` replaces `athena.auth.revokeSession()`
- `athena.auth.session.revokeOther()` replaces
  `athena.auth.revokeOtherSessions()`

The existing methods remain available during the 5.x compatibility window. In
development, each emits one warning per client; production logs remain quiet.
