# Athena JS

current version: `5.7.0`

[![npm](https://img.shields.io/npm/v/@xylex-group/athena?label=%40xylex-group%2Fathena&logo=npm)](https://www.npmjs.com/package/@xylex-group/athena)
[![npm downloads](https://img.shields.io/npm/dm/@xylex-group/athena?logo=npm)](https://www.npmjs.com/package/@xylex-group/athena)

```bash
pnpm add @xylex-group/athena
```

`@xylex-group/athena` is the TypeScript SDK and embedded backend runtime for Athena. It talks to dedicated Athena services, or it runs Auth, Data, Storage, Billing, and Chat against PostgreSQL in process.

Docs: [https://athena.xbp.app](https://athena.xbp.app)

Canonical development is this package in [xylex-group/athena](https://github.com/xylex-group/athena). The public source tree is [xylex-group/athena-js](https://github.com/xylex-group/athena-js).

## Create a client

Dedicated Athena:

```ts
import { createClient } from "@xylex-group/athena";

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

Database-only (Auth off):

```ts
const athenaDb = createClient({
  databaseUrl: process.env.DATABASE_URL!,
  auth: false,
});
```

Remote Auth uses `ATHENA_AUTH_URL` when the Auth service is deployed separately.

The same application surface works in either topology:

```ts
athena.from("users");
athena.rpc("my_function");
athena.auth;
athena.storage;
athena.billing;
```

Athena JS compiles queries locally and ships embedded runtimes with conformance suites against the Rust Gateway and Rust Auth. It runs on Node.js, browsers, React, Next.js, React Native, and Cloudflare Workers.

## Docs in this tree

| Guide | Path |
| --- | --- |
| Getting started | [docs/getting-started.md](docs/getting-started.md) |
| Next.js | [docs/next-js.md](docs/next-js.md) |
| Deprecations / 6.0.0 | [docs/deprecations.md](docs/deprecations.md) |
| API reference | [docs/api-reference.md](docs/api-reference.md) |
| CLI | [docs/cli-command-reference.md](docs/cli-command-reference.md) |
| Release verification | [docs/release-verification.md](docs/release-verification.md) |

## Deprecations

See [docs/deprecations.md](docs/deprecations.md). In 5.x, `athena.query()` is deprecated and will be removed in 6.0.0; use `athena.admin.query()` or `athena.db.query()`. Flat auth aliases (`listAccounts`, `unlinkAccount`, passkey `listUserPasskeys` / `updatePasskey` / `deletePasskey`, email/user-delete, and session helpers) move to nested `athena.auth.account`, `athena.auth.passkey`, `athena.auth.email`, `athena.auth.user.delete`, and `athena.auth.session` methods.

## CLI

The `athena-js` binary ships with this package. Per-invocation JSONL traces are written under `%USERPROFILE%\.athena\logs\athena-js` on Windows and `~/.athena/logs/athena-js` on Linux/macOS. Override the home with `ATHENA_HOME`. Set `ATHENA_CLI_LOG=off|errors|all|debug`. Use `athena-js logs path|list|latest|show|export|prune` for support-safe exports. `--no-log` and `ATHENA_CLI_LOG=off` disable persistent logging.

Credential flags are redacted. Athena does not upload CLI logs.

## Related packages

[![npm](https://img.shields.io/npm/v/@xylex-group/athena-auth-ui?label=%40xylex-group%2Fathena-auth-ui&logo=npm)](https://www.npmjs.com/package/@xylex-group/athena-auth-ui)

- `@xylex-group/athena-auth-ui` — React Auth UI on the same client
- `athena-py` — async Python SDK for the Gateway
- `@xylex-group/better-auth-athena` — Better Auth database adapter
- `@xylex-group/athena-mcp` — Model Context Protocol tools
- `@xylex-group/chat-adapter-athena` — Vercel Chat SDK persistence
- `create-athena-app` — init, upgrade, and scaffold Athena apps

## Development

Clone this repo or work in the monorepo package:

```bash
pnpm install
pnpm build
pnpm test:finality
```

Local `pnpm test:finality` is the release source of truth. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
