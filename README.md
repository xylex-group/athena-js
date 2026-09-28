# Athena

current version: `5.6.9`
[![npm](https://img.shields.io/npm/v/@xylex-group/athena?label=%40xylex-group%2Fathena&logo=npm)](https://www.npmjs.com/package/@xylex-group/athena)
[![npm downloads](https://img.shields.io/npm/dm/@xylex-group/athena?logo=npm)](https://www.npmjs.com/package/@xylex-group/athena)

```bash
pnpm add @xylex-group/athena
```

`@xylex-group/athena` is both the TypeScript SDK for the Rust services and an embedded backend runtime.

Dedicated Athena:

```ts
const athena = createClient({
  url: process.env.ATHENA_URL!,
  key: process.env.ATHENA_API_KEY!,
});
```

Direct PostgreSQL + embedded Auth:

```ts
import { createClient } from "@xylex-group/athena/server";

const athena = createClient({
  databaseUrl: process.env.DATABASE_URL!,
});
```

Database-only clients can disable Auth explicitly:

```ts
const athenaDb = createClient({
  databaseUrl: process.env.DATABASE_URL!,
  auth: false,
});
```

Remote Auth can be selected with `ATHENA_AUTH_URL` when the Auth service is deployed separately.

Application code uses the same surface in either topology:

```ts
athena.from("users");
athena.rpc("my_function");
athena.auth;
athena.storage;
athena.billing;
```

Athena JS contains its own query compilation and embedded runtime implementations with conformance and parity suites against the Rust Gateway and Rust Auth behavior.

It supports Node.js, browsers, React, Next.js, React Native and Cloudflare Workers.

## Deprecations

See [the deprecations and 6.0.0 sunset list](docs/deprecations.md). In
particular, `athena.query()` is deprecated in Athena 5.x and will be removed
in Athena 6.0.0; use `athena.admin.query()` or `athena.db.query()` instead.
The flat auth aliases `athena.auth.listAccounts()` and
`athena.auth.unlinkAccount()` are also deprecated; use the nested
`athena.auth.account` methods.
The verbose passkey methods `athena.auth.passkey.listUserPasskeys()`,
`athena.auth.passkey.updatePasskey()`, and
`athena.auth.passkey.deletePasskey()` are also deprecated; use
`athena.auth.passkey.listUser()`, `athena.auth.passkey.update()`, and
`athena.auth.passkey.delete()`.
The flat auth email and user-delete methods are also deprecated; use the
grouped `athena.auth.verificationEmail`, `athena.auth.email`, and
`athena.auth.user.delete` namespaces.
The flat session aliases are also deprecated; use
`athena.auth.session.list()`, `athena.auth.session.revoke()`, and
`athena.auth.session.revokeOther()`.

## CLI logging

The `athena-js` CLI records a redacted, per-invocation JSONL trace by default:

- Windows: `%USERPROFILE%\.athena\logs\athena-js`
- Linux/macOS: `~/.athena/logs/athena-js`
- Override the home with `ATHENA_HOME`; relative overrides resolve from the current working directory.
- Set `ATHENA_CLI_LOG=off|errors|all|debug` to change collection. `errors` keeps only a bounded in-memory buffer until a failure.
- Retention defaults to 30 days and the total CLI log quota defaults to 100 MiB. Configure them with `ATHENA_CLI_LOG_RETENTION_DAYS` and `ATHENA_CLI_LOG_MAX_BYTES`.

Use `athena-js logs path|list|latest|show|export|prune` to inspect or create a support-safe export. `logs latest` and `doctor bundle --include-latest-log` select a prior completed invocation, not the command currently running. `--no-log` and `ATHENA_CLI_LOG=off` disable persistent logging, including pre-runtime fallback logging.

Known credential flags use semantic flag/value redaction for both `--flag value` and `--flag=value`; authorization material, cookies, private keys, URL passwords and token-shaped values are also redacted as defense in depth. Heuristic redaction cannot identify arbitrary secrets supplied as unlabelled positional text, so do not use diagnostic logs as a secret store. Log, export, and bundle files are created with restrictive permissions where the platform supports them (0600 files and 0700 directories). Athena does not upload CLI logs automatically; provide a bundle only after reviewing it.

## Auth UI

[![npm](https://img.shields.io/npm/v/@xylex-group/athena-auth-ui?label=%40xylex-group%2Fathena-auth-ui&logo=npm)](https://www.npmjs.com/package/@xylex-group/athena-auth-ui)
[![npm downloads](https://img.shields.io/npm/dm/@xylex-group/athena-auth-ui?logo=npm)](https://www.npmjs.com/package/@xylex-group/athena-auth-ui)

`@xylex-group/athena-auth-ui` is the React UI layer for Athena Auth.

It provides authentication, account, organization, invitation and administration surfaces on top of the same `@xylex-group/athena` client.

## Other packages

`athena-py` provides an asynchronous Python SDK for the Athena Gateway.

`@xylex-group/better-auth-athena` integrates Better Auth with Athena as its database adapter.

`@xylex-group/athena-mcp` exposes Athena through the Model Context Protocol for AI agents and development tools.

`@xylex-group/chat-adapter-athena` provides Athena persistence for the Vercel Chat SDK.

`create-athena-app` initializes, upgrades, audits and scaffolds Athena integrations in new and existing applications.
