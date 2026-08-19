# Changelog

## Unreleased

- `AthenaLayeredServerClient.withContext` now returns `unknown` so strongly typed model roots assign into `createAthenaServerClient({ client })` without comparing the full `AthenaClient` database surface (TS2589 / assignability).

## [5.2.0](https://github.com/xylex-group/athena/compare/athena-js-5.1.1...athena-js-5.2.0) (2026-08-18)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-5.2.0`

### Notes

- Next discovery is runtime-capability protocol **1.1** (`runtime: "next-local"`).
  `createAthenaNextHandlers({ client })` advertises Auth from
  `AthenaClientInternals.plan` only — it does not re-run `inferEmbeddedAuthMode()`.
  Browser `createClient({ topology: { discover: "next" } })` resolves
  `ResolvedNextAthenaTopology` and attaches same-origin `/api/auth` without
  `auth.routing`. Explicit `auth: false` / `auth.mode: "remote"` + `auth.url` still win.
- **Migration:** drop `createAthenaBrowserClient`, `auth.routing: "same-origin"`,
  and Auth UI `basePath` / `ATHENA_AUTH_URL` from the Local Runtime golden path.
  Protocol 1.0 Data-only documents remain Data-compatible and never imply Auth.
- **Diagnostics:** `ATHENA_DISCOVERY_UNAVAILABLE` is a Data probe failure;
  `ATHENA_AUTH_NOT_AVAILABLE` is Data-ok / Auth-off. Do not collapse these.
- Constructor inference is unchanged: Node `createClient({ databaseUrl })` still
  folds embedded Auth via `inferEmbeddedAuthMode()`.
- ADR: [0020](../../docs/adr/technical/0020-athena-next-runtime-capability-discovery.md).

## [5.1.1](https://github.com/xylex-group/athena/compare/athena-js-5.0.0...athena-js-5.1.1) (2026-08-18)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-5.1.1`

## [5.0.0](https://github.com/xylex-group/athena/compare/athena-js-4.3.3...athena-js-5.0.0) (2026-08-13)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-5.0.0`

## [4.3.3](https://github.com/xylex-group/athena/compare/athena-mcp-0.1.7+exp...athena-js-4.3.3) (2026-08-12)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-4.3.3`

## [0.1.7+exp](https://github.com/xylex-group/athena/compare/athena-mcp-0.3.0...athena-mcp-0.1.7+exp) (2026-07-28)

- Service: `athena-mcp`
- Release channel: experimental
- Tag: `athena-mcp-0.1.7+exp`

## [0.3.0](https://github.com/xylex-group/athena/compare/athena-mcp-0.4.0...athena-mcp-0.3.0) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.3.0`

## [0.4.0](https://github.com/xylex-group/athena/compare/athena-mcp-0.4.1...athena-mcp-0.4.0) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.4.0`

## [0.4.1](https://github.com/xylex-group/athena/compare/athena-mcp-0.4.2...athena-mcp-0.4.1) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.4.1`

## [0.4.2](https://github.com/xylex-group/athena/compare/athena-mcp-0.5.0...athena-mcp-0.4.2) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.4.2`

## [0.5.0](https://github.com/xylex-group/athena/compare/athena-mcp-0.5.1...athena-mcp-0.5.0) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.5.0`

## [0.5.1](https://github.com/xylex-group/athena/compare/athena-mcp-0.5.2...athena-mcp-0.5.1) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.5.1`

## [0.5.2](https://github.com/xylex-group/athena/compare/athena-py-0.1.0...athena-mcp-0.5.2) (2026-07-28)

- Service: `athena-mcp`
- Release channel: stable
- Tag: `athena-mcp-0.5.2`

## [0.1.0](https://github.com/xylex-group/athena/compare/athena-js-3.5.1...athena-py-0.1.0) (2026-07-28)

- Service: `athena-py`
- Release channel: stable
- Tag: `athena-py-0.1.0`

## [3.5.1](https://github.com/xylex-group/athena/compare/athena-audit-cli-4.0.4...athena-js-3.5.1) (2026-07-27)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.5.1`

## [4.0.4](https://github.com/xylex-group/athena/compare/athena-4.1.3...athena-audit-cli-4.0.4) (2026-07-25)

- Service: `athena-audit-cli`
- Release channel: stable
- Tag: `athena-audit-cli-4.0.4`

## [4.1.3](https://github.com/xylex-group/athena/compare/athena-auth-ui-2.7.0...athena-4.1.3) (2026-07-25)

- Service: `athena`
- Release channel: stable
- Tag: `athena-4.1.3`

## [2.7.0](https://github.com/xylex-group/athena/compare/create-athena-app-v0.3.1...athena-auth-ui-2.7.0) (2026-07-25)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2.7.0`

## [0.3.1](https://github.com/xylex-group/athena/compare/athena-studio-4.1.0...create-athena-app-v0.3.1) (2026-07-24)

- Service: `create-athena-app`
- Release channel: stable
- Tag: `create-athena-app-v0.3.1`

## [4.1.0](https://github.com/xylex-group/athena/compare/athena-storage-4.0.2...athena-studio-4.1.0) (2026-07-24)

- Service: `athena-studio`
- Release channel: stable
- Tag: `athena-studio-4.1.0`

## [4.0.2](https://github.com/xylex-group/athena/compare/athena-s3-4.0.3...athena-storage-4.0.2) (2026-07-24)

- Service: `athena-storage`
- Release channel: stable
- Tag: `athena-storage-4.0.2`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-r2-4.0.2...athena-s3-4.0.3) (2026-07-24)

- Service: `athena-s`
- Release channel: stable
- Tag: `athena-s3-4.0.3`

## [4.0.2](https://github.com/xylex-group/athena/compare/athena-operator-0.3.0...athena-r2-4.0.2) (2026-07-24)

- Service: `athena-r`
- Release channel: stable
- Tag: `athena-r2-4.0.2`

## [0.3.0](https://github.com/xylex-group/athena/compare/athena-js-3.3.0...athena-operator-0.3.0) (2026-07-24)

- Service: `athena-operator`
- Release channel: stable
- Tag: `athena-operator-0.3.0`

## [3.3.0](https://github.com/xylex-group/athena/compare/athena-billing-stripe-4.0.3...athena-js-3.3.0) (2026-07-24)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.3.0`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-billing-mollie-4.0.3...athena-billing-stripe-4.0.3) (2026-07-24)

- Service: `athena-billing-stripe`
- Release channel: stable
- Tag: `athena-billing-stripe-4.0.3`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-backups-4.0.3...athena-billing-mollie-4.0.3) (2026-07-24)

- Service: `athena-billing-mollie`
- Release channel: stable
- Tag: `athena-billing-mollie-4.0.3`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-auth-ui-2.3.0...athena-backups-4.0.3) (2026-07-24)

- Service: `athena-backups`
- Release channel: stable
- Tag: `athena-backups-4.0.3`

## [2.3.0](https://github.com/xylex-group/athena/compare/athena-audit-cli-4.0.3...athena-auth-ui-2.3.0) (2026-07-24)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2.3.0`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-auth-ui-2.6.0...athena-audit-cli-4.0.3) (2026-07-24)

- Service: `athena-audit-cli`
- Release channel: stable
- Tag: `athena-audit-cli-4.0.3`

## [2.6.0](https://github.com/xylex-group/athena/compare/athena-js-3.2.0...athena-auth-ui-2.6.0) (2026-07-24)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2.6.0`

## [3.2.0](https://github.com/xylex-group/athena/compare/athena-4.1.2...athena-js-3.2.0) (2026-07-22)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.2.0`

## [4.1.2](https://github.com/xylex-group/athena/compare/athena-js-3.1.2...athena-4.1.2) (2026-07-22)

- Service: `athena`
- Release channel: stable
- Tag: `athena-4.1.2`

## [3.1.2](https://github.com/xylex-group/athena/compare/docs-4.0.1...athena-js-3.1.2) (2026-07-22)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.1.2`

## [4.0.1](https://github.com/xylex-group/athena/compare/athena-worker-4.0.3...docs-4.0.1) (2026-07-22)

- Service: `docs`
- Release channel: stable
- Tag: `docs-4.0.1`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-scheduler-4.0.3...athena-worker-4.0.3) (2026-07-22)

- Service: `athena-worker`
- Release channel: stable
- Tag: `athena-worker-4.0.3`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-daemon-4.0.3...athena-scheduler-4.0.3) (2026-07-22)

- Service: `athena-scheduler`
- Release channel: stable
- Tag: `athena-scheduler-4.0.3`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-auth-ui-2.2.0...athena-daemon-4.0.3) (2026-07-22)

- Service: `athena-daemon`
- Release channel: stable
- Tag: `athena-daemon-4.0.3`

## [2.2.0](https://github.com/xylex-group/athena/compare/athena-auth-1.14.3...athena-auth-ui-2.2.0) (2026-07-22)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2.2.0`

## [1.14.3](https://github.com/xylex-group/athena/compare/athena-4.1.1...athena-auth-1.14.3) (2026-07-22)

- Service: `athena-auth`
- Release channel: stable
- Tag: `athena-auth-1.14.3`

## [4.1.1](https://github.com/xylex-group/athena/compare/athena-js-3.1.1...athena-4.1.1) (2026-07-22)

- Service: `athena`
- Release channel: stable
- Tag: `athena-4.1.1`

## [3.1.1](https://github.com/xylex-group/athena/compare/athena-4.0.3...athena-js-3.1.1) (2026-07-21)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.1.1`

## [4.0.3](https://github.com/xylex-group/athena/compare/athena-auth-ui-2.1.0...athena-4.0.3) (2026-07-21)

- Service: `athena`
- Release channel: stable
- Tag: `athena-4.0.3`

## [2.1.0](https://github.com/xylex-group/athena/compare/v3.1.0...athena-auth-ui-2.1.0) (2026-07-21)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2.1.0`

## [3.1.0](https://github.com/xylex-group/athena/compare/athena-js-3.1.0...v3.1.0) (2026-07-18)

- Service: `repository`
- Release channel: stable
- Tag: `v3.1.0`

## [3.1.0](https://github.com/xylex-group/athena/compare/athena-operator-0.2.0...athena-js-3.1.0) (2026-07-18)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.1.0`

## [0.2.0](https://github.com/xylex-group/athena/compare/v3.0.2...athena-operator-0.2.0) (2026-07-18)

- Service: `athena-operator`
- Release channel: stable
- Tag: `athena-operator-0.2.0`

## [3.0.2](https://github.com/xylex-group/athena/compare/athena-auth-1.14.2...v3.0.2) (2026-07-18)

- Service: `repository`
- Release channel: stable
- Tag: `v3.0.2`

## [1.14.2](https://github.com/xylex-group/athena/compare/v1.14.2...athena-auth-1.14.2) (2026-07-16)

- Service: `athena-auth`
- Release channel: stable
- Tag: `athena-auth-1.14.2`

## [1.14.2](https://github.com/xylex-group/athena/compare/v4.0.0...v1.14.2) (2026-07-16)

- Service: `repository`
- Release channel: stable
- Tag: `v1.14.2`

## [4.0.0](https://github.com/xylex-group/athena/compare/athena-rs-4.0.0...v4.0.0) (2026-07-16)

- Service: `repository`
- Release channel: stable
- Tag: `v4.0.0`

## [4.0.0](https://github.com/xylex-group/athena/compare/repository-2.0.0...athena-rs-4.0.0) (2026-07-16)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-4.0.0`

## [2.0.0](https://github.com/xylex-group/athena/compare/athena-auth-ui-2.0.0...repository-2.0.0) (2026-07-16)

- Service: `repository`
- Release channel: stable
- Tag: `repository-2.0.0`

## [2.0.0](https://github.com/xylex-group/athena/compare/v3.0.0...athena-auth-ui-2.0.0) (2026-07-16)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2.0.0`

## [3.0.0](https://github.com/xylex-group/athena/compare/athena-js-3.0.0...v3.0.0) (2026-07-16)

- Service: `repository`
- Release channel: stable
- Tag: `v3.0.0`

## [3.0.0](https://github.com/xylex-group/athena/compare/repository-1.16.1...athena-js-3.0.0) (2026-07-16)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-3.0.0`

## [1.16.1](https://github.com/xylex-group/athena/compare/athena-auth-ui-1.16.1...repository-1.16.1) (2026-07-13)

- Service: `repository`
- Release channel: stable
- Tag: `repository-1.16.1`

## [1.16.1](https://github.com/xylex-group/athena/compare/athena-audit-cli-3.28.0...athena-auth-ui-1.16.1) (2026-07-13)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-1.16.1`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-backups-3.28.1...athena-audit-cli-3.28.0) (2026-07-13)

- Service: `athena-audit-cli`
- Release channel: stable
- Tag: `athena-audit-cli-3.28.0`

## [3.28.1](https://github.com/xylex-group/athena/compare/athena-billing-mollie-3.28.0...athena-backups-3.28.1) (2026-07-13)

- Service: `athena-backups`
- Release channel: stable
- Tag: `athena-backups-3.28.1`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-billing-stripe-3.28.0...athena-billing-mollie-3.28.0) (2026-07-13)

- Service: `athena-billing-mollie`
- Release channel: stable
- Tag: `athena-billing-mollie-3.28.0`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-js-2.16.0...athena-billing-stripe-3.28.0) (2026-07-13)

- Service: `athena-billing-stripe`
- Release channel: stable
- Tag: `athena-billing-stripe-3.28.0`

## [2.16.0](https://github.com/xylex-group/athena/compare/athena-r2-3.28.1...athena-js-2.16.0) (2026-07-13)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-2.16.0`

## [3.28.1](https://github.com/xylex-group/athena/compare/athena-s3-3.29.0...athena-r2-3.28.1) (2026-07-13)

- Service: `athena-r`
- Release channel: stable
- Tag: `athena-r2-3.28.1`

## [3.29.0](https://github.com/xylex-group/athena/compare/athena-storage-3.29.0...athena-s3-3.29.0) (2026-07-13)

- Service: `athena-s`
- Release channel: stable
- Tag: `athena-s3-3.29.0`

## [3.29.0](https://github.com/xylex-group/athena/compare/athena-storage-core-3.28.1...athena-storage-3.29.0) (2026-07-13)

- Service: `athena-storage`
- Release channel: stable
- Tag: `athena-storage-3.29.0`

## [3.28.1](https://github.com/xylex-group/athena/compare/athena-s3-3.28.0...athena-storage-core-3.28.1) (2026-07-13)

- Service: `athena-storage-core`
- Release channel: stable
- Tag: `athena-storage-core-3.28.1`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-r2-3.28.0...athena-s3-3.28.0) (2026-07-13)

- Service: `athena-s`
- Release channel: stable
- Tag: `athena-s3-3.28.0`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-storage-core-3.28.0...athena-r2-3.28.0) (2026-07-13)

- Service: `athena-r`
- Release channel: stable
- Tag: `athena-r2-3.28.0`

## [3.28.0](https://github.com/xylex-group/athena/compare/web-3.27.1...athena-storage-core-3.28.0) (2026-07-13)

- Service: `athena-storage-core`
- Release channel: stable
- Tag: `athena-storage-core-3.28.0`

## [3.27.1](https://github.com/xylex-group/athena/compare/docs-3.28.0...web-3.27.1) (2026-07-13)

- Service: `web`
- Release channel: stable
- Tag: `web-3.27.1`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-js-2.14.0...docs-3.28.0) (2026-07-13)

- Service: `docs`
- Release channel: stable
- Tag: `docs-3.28.0`

## [2.14.0](https://github.com/xylex-group/athena/compare/athena-storage-3.28.0...athena-js-2.14.0) (2026-07-13)

- Service: `athena-js`
- Release channel: stable
- Tag: `athena-js-2.14.0`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-backups-3.28.0...athena-storage-3.28.0) (2026-07-13)

- Service: `athena-storage`
- Release channel: stable
- Tag: `athena-storage-3.28.0`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-rs-3.28.0...athena-backups-3.28.0) (2026-07-13)

- Service: `athena-backups`
- Release channel: stable
- Tag: `athena-backups-3.28.0`

## [3.28.0](https://github.com/xylex-group/athena/compare/athena-rs-3.27.1...athena-rs-3.28.0) (2026-07-13)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.28.0`

## [3.27.1](https://github.com/xylex-group/athena/compare/v2.13.0+nightly...athena-rs-3.27.1) (2026-07-13)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.27.1`

## [2.13.0+nightly](https://github.com/xylex-group/athena/compare/xylex-group-athena-auth-ui-1.17.0+nightly...v2.13.0+nightly) (2026-07-12)

- Service: `repository`
- Release channel: nightly
- Tag: `v2.13.0+nightly`

## [1.17.0+nightly](https://github.com/xylex-group/athena/compare/v1.16.0...xylex-group-athena-auth-ui-1.17.0+nightly) (2026-07-10)

- Service: `xylex-group-athena-auth-ui`
- Release channel: nightly
- Tag: `xylex-group-athena-auth-ui-1.17.0+nightly`

## [1.16.0](https://github.com/xylex-group/athena/compare/v3.27.0...v1.16.0) (2026-07-09)

- Service: `repository`
- Release channel: stable
- Tag: `v1.16.0`

## [3.27.0](https://github.com/xylex-group/athena/compare/v1.15.0...v3.27.0) (2026-07-09)

- Service: `repository`
- Release channel: stable
- Tag: `v3.27.0`

## [1.15.0](https://github.com/xylex-group/athena/compare/v1.14.0...v1.15.0) (2026-07-09)

- Service: `repository`
- Release channel: stable
- Tag: `v1.15.0`

## [1.14.0](https://github.com/xylex-group/athena/compare/1.14.0-athena-auth...v1.14.0) (2026-07-08)

- Service: `repository`
- Release channel: stable
- Tag: `v1.14.0`

## [1.14.0](https://github.com/xylex-group/athena/compare/athena-auth-ui-2-1.13.2...1.14.0-athena-auth) (2026-07-08)

- Service: `athena-auth`
- Release channel: stable
- Tag: `1.14.0-athena-auth`

## [1.13.2](https://github.com/xylex-group/athena/compare/1.13.2-athena-auth-ui...athena-auth-ui-2-1.13.2) (2026-07-08)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `athena-auth-ui-2-1.13.2`

## [1.13.2](https://github.com/xylex-group/athena/compare/v1.13.1...1.13.2-athena-auth-ui) (2026-07-08)

- Service: `athena-auth-ui`
- Release channel: stable
- Tag: `1.13.2-athena-auth-ui`

## [1.13.1](https://github.com/xylex-group/athena/compare/athena-rs-3.26.6...v1.13.1) (2026-07-07)

- Service: `repository`
- Release channel: stable
- Tag: `v1.13.1`

## [3.26.6](https://github.com/xylex-group/athena/compare/athena-rs-3.26.5...athena-rs-3.26.6) (2026-07-05)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.26.6`

## [3.26.5](https://github.com/xylex-group/athena/compare/v1.13.0...athena-rs-3.26.5) (2026-07-05)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.26.5`

## [1.13.0](https://github.com/xylex-group/athena/compare/v1.12.0...v1.13.0) (2026-07-04)

- Service: `repository`
- Release channel: stable
- Tag: `v1.13.0`

## [1.12.0](https://github.com/xylex-group/athena/compare/athena-rs-3.26.3...v1.12.0) (2026-07-04)

- Service: `repository`
- Release channel: stable
- Tag: `v1.12.0`

## [3.26.3](https://github.com/xylex-group/athena/compare/v3.26.3...athena-rs-3.26.3) (2026-07-03)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.26.3`

## [3.26.3](https://github.com/xylex-group/athena/compare/v1.11.0...v3.26.3) (2026-07-03)

- Service: `repository`
- Release channel: stable
- Tag: `v3.26.3`

## [1.11.0](https://github.com/xylex-group/athena/compare/athena-rs-3.26.2...v1.11.0) (2026-07-03)

- Service: `repository`
- Release channel: stable
- Tag: `v1.11.0`

## [3.26.2](https://github.com/xylex-group/athena/compare/athena-rs-3.26.1...athena-rs-3.26.2) (2026-07-02)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.26.2`

## [3.26.1](https://github.com/xylex-group/athena/compare/v2.12.1...athena-rs-3.26.1) (2026-07-02)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.26.1`

## [2.12.1](https://github.com/xylex-group/athena/compare/athena-rs-3.23.2...v2.12.1) (2026-07-02)

- Service: `repository`
- Release channel: stable
- Tag: `v2.12.1`

## [3.23.2](https://github.com/xylex-group/athena/compare/v1.10.2...athena-rs-3.23.2) (2026-07-02)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.23.2`

## [1.10.2](https://github.com/xylex-group/athena/compare/v2.12.0...v1.10.2) (2026-07-02)

- Service: `repository`
- Release channel: stable
- Tag: `v1.10.2`

## [2.12.0](https://github.com/xylex-group/athena/compare/v3.22.1...v2.12.0) (2026-06-30)

- Service: `repository`
- Release channel: stable
- Tag: `v2.12.0`

## [3.22.1](https://github.com/xylex-group/athena/compare/athena-rs-3.22.1...v3.22.1) (2026-06-30)

- Service: `repository`
- Release channel: stable
- Tag: `v3.22.1`

## [3.22.1](https://github.com/xylex-group/athena/compare/v2.11.0...athena-rs-3.22.1) (2026-06-30)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.22.1`

## [2.11.0](https://github.com/xylex-group/athena/compare/v2.10.0...v2.11.0) (2026-06-29)

- Service: `repository`
- Release channel: stable
- Tag: `v2.11.0`

## [2.10.0](https://github.com/xylex-group/athena/compare/v1.12.2...v2.10.0) (2026-06-27)

- Service: `repository`
- Release channel: stable
- Tag: `v2.10.0`

## [1.12.2](https://github.com/xylex-group/athena/compare/athena-rs-3.21.2...v1.12.2) (2026-06-27)

- Service: `repository`
- Release channel: stable
- Tag: `v1.12.2`

## [3.21.2](https://github.com/xylex-group/athena/compare/v1.10.1...athena-rs-3.21.2) (2026-06-24)

- Service: `athena-rs`
- Release channel: stable
- Tag: `athena-rs-3.21.2`

## [1.10.1](https://github.com/xylex-group/athena/compare/v2.9.0...v1.10.1) (2026-06-24)

- Service: `repository`
- Release channel: stable
- Tag: `v1.10.1`

## [2.9.0](https://github.com/xylex-group/athena/compare/v1.9.2...v2.9.0) (2026-06-20)

- Service: `repository`
- Release channel: stable
- Tag: `v2.9.0`

## [1.9.2](https://github.com/xylex-group/athena/compare/v2.8.2...v1.9.2) (2026-06-20)

- Service: `repository`
- Release channel: stable
- Tag: `v1.9.2`

## [2.8.2](https://github.com/xylex-group/athena/compare/v3.18.0...v2.8.2) (2026-06-18)

- Service: `repository`
- Release channel: stable
- Tag: `v2.8.2`

## [3.18.0](https://github.com/xylex-group/athena/compare/v2.7.0...v3.18.0) (2026-06-16)

- Service: `repository`
- Release channel: stable
- Tag: `v3.18.0`

## [2.7.0](https://github.com/xylex-group/athena/compare/v3.17.0...v2.7.0) (2026-06-15)

- Service: `repository`
- Release channel: stable
- Tag: `v2.7.0`

## [3.17.0](https://github.com/xylex-group/athena/compare/v0.3.0...v3.17.0) (2026-06-15)

- Service: `repository`
- Release channel: stable
- Tag: `v3.17.0`

## [0.3.0](https://github.com/xylex-group/athena/compare/v1.9.0...v0.3.0) (2026-06-15)

- Service: `repository`
- Release channel: stable
- Tag: `v0.3.0`

## [1.9.0](https://github.com/xylex-group/athena/compare/v1.8.4...v1.9.0) (2026-06-14)

- Service: `repository`
- Release channel: stable
- Tag: `v1.9.0`

## [1.8.4](https://github.com/xylex-group/athena/compare/v0.2.0...v1.8.4) (2026-06-14)

- Service: `repository`
- Release channel: stable
- Tag: `v1.8.4`

## [0.2.0](https://github.com/xylex-group/athena/compare/v2.4.1...v0.2.0) (2026-06-12)

- Service: `repository`
- Release channel: stable
- Tag: `v0.2.0`

## [2.4.1](https://github.com/xylex-group/athena/compare/v3.16.5...v2.4.1) (2026-06-12)

- Service: `repository`
- Release channel: stable
- Tag: `v2.4.1`

## [3.16.5](https://github.com/xylex-group/athena/compare/v3.16.4...v3.16.5) (2026-06-12)

- Service: `repository`
- Release channel: stable
- Tag: `v3.16.5`

## [3.16.4](https://github.com/xylex-group/athena/compare/v3.16.3-alpha.1...v3.16.4) (2026-06-12)

- Service: `repository`
- Release channel: stable
- Tag: `v3.16.4`

## [3.16.3-alpha.1](https://github.com/xylex-group/athena/compare/v3.16.2-alpha.1...v3.16.3-alpha.1) (2026-06-11)

- Service: `repository`
- Release channel: experimental
- Tag: `v3.16.3-alpha.1`

## [3.16.2-alpha.1](https://github.com/xylex-group/athena/compare/v3.16.1...v3.16.2-alpha.1) (2026-06-10)

- Service: `repository`
- Release channel: experimental
- Tag: `v3.16.2-alpha.1`

## [3.16.1](https://github.com/xylex-group/athena/compare/v3.16.0...v3.16.1) (2026-06-09)

- Service: `repository`
- Release channel: stable
- Tag: `v3.16.1`

## [3.16.0](https://github.com/xylex-group/athena/compare/v2.4.0...v3.16.0) (2026-06-09)

- Service: `repository`
- Release channel: stable
- Tag: `v3.16.0`

## [2.4.0](https://github.com/xylex-group/athena/compare/v1.8.2...v2.4.0) (2026-06-05)

- Service: `repository`
- Release channel: stable
- Tag: `v2.4.0`

## [1.8.2](https://github.com/xylex-group/athena/compare/v3.15.1...v1.8.2) (2026-06-05)

- Service: `repository`
- Release channel: stable
- Tag: `v1.8.2`

## [3.15.1](https://github.com/xylex-group/athena/compare/v3.15.0...v3.15.1) (2026-06-05)

- Service: `repository`
- Release channel: stable
- Tag: `v3.15.1`

## [3.15.0](https://github.com/xylex-group/athena/compare/v2.2.0...v3.15.0) (2026-06-04)

- Service: `repository`
- Release channel: stable
- Tag: `v3.15.0`

## [2.2.0](https://github.com/xylex-group/athena/compare/v3.13.2...v2.2.0) (2026-06-01)

- Service: `repository`
- Release channel: stable
- Tag: `v2.2.0`

## [3.13.2](https://github.com/xylex-group/athena/compare/v2.1.2...v3.13.2) (2026-06-01)

- Service: `repository`
- Release channel: stable
- Tag: `v3.13.2`

## [2.1.2](https://github.com/xylex-group/athena/compare/v2.1.1...v2.1.2) (2026-05-31)

- Service: `repository`
- Release channel: stable
- Tag: `v2.1.2`

## [2.1.1](https://github.com/xylex-group/athena/compare/v2.1.0...v2.1.1) (2026-05-30)

- Service: `repository`
- Release channel: stable
- Tag: `v2.1.1`

## [2.1.0](https://github.com/xylex-group/athena/compare/v1.7.0...v2.1.0) (2026-05-29)

- Service: `repository`
- Release channel: stable
- Tag: `v2.1.0`

## [1.7.0](https://github.com/xylex-group/athena/compare/v1.6.0...v1.7.0) (2026-05-29)

- Service: `repository`
- Release channel: stable
- Tag: `v1.7.0`

## [1.6.0](https://github.com/xylex-group/athena/compare/v3.13.0...v1.6.0) (2026-05-29)

- Service: `repository`
- Release channel: stable
- Tag: `v1.6.0`

## [3.13.0](https://github.com/xylex-group/athena/compare/v1.5.0...v3.13.0) (2026-05-29)

- Service: `repository`
- Release channel: stable
- Tag: `v3.13.0`

## [1.5.0](https://github.com/xylex-group/athena/compare/v1.8.0...v1.5.0) (2026-05-25)

- Service: `repository`
- Release channel: stable
- Tag: `v1.5.0`

## [1.8.0](https://github.com/xylex-group/athena/compare/v1.4.1...v1.8.0) (2026-05-23)

- Service: `repository`
- Release channel: stable
- Tag: `v1.8.0`

## [1.4.1](https://github.com/xylex-group/athena/compare/v1.4.0...v1.4.1) (2026-05-22)

- Service: `repository`
- Release channel: stable
- Tag: `v1.4.1`

## [1.4.0](https://github.com/xylex-group/athena/compare/v1.3.1...v1.4.0) (2026-05-20)

- Service: `repository`
- Release channel: stable
- Tag: `v1.4.0`

## [1.3.1](https://github.com/xylex-group/athena/compare/v1.6.2...v1.3.1) (2026-05-19)

- Service: `repository`
- Release channel: stable
- Tag: `v1.3.1`

## [1.6.2](https://github.com/xylex-group/athena/compare/v1.6.1...v1.6.2) (2026-05-17)

- Service: `repository`
- Release channel: stable
- Tag: `v1.6.2`

## [1.6.1](https://github.com/xylex-group/athena/compare/v1.2.7...v1.6.1) (2026-05-16)

- Service: `repository`
- Release channel: stable
- Tag: `v1.6.1`

## [1.2.7](https://github.com/xylex-group/athena/compare/v1.2.6...v1.2.7) (2026-05-10)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.7`

## [1.2.6](https://github.com/xylex-group/athena/compare/v1.2.5...v1.2.6) (2026-05-08)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.6`

## [1.2.5](https://github.com/xylex-group/athena/compare/v1.2.4...v1.2.5) (2026-05-07)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.5`

## [1.2.4](https://github.com/xylex-group/athena/compare/v1.2.2...v1.2.4) (2026-05-07)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.4`

## [1.2.2](https://github.com/xylex-group/athena/compare/v3.12.3...v1.2.2) (2026-05-07)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.2`

## [3.12.3](https://github.com/xylex-group/athena/compare/v3.12.2...v3.12.3) (2026-05-04)

- Service: `repository`
- Release channel: stable
- Tag: `v3.12.3`

## [3.12.2](https://github.com/xylex-group/athena/compare/v3.12.1...v3.12.2) (2026-05-04)

- Service: `repository`
- Release channel: stable
- Tag: `v3.12.2`

## [3.12.1](https://github.com/xylex-group/athena/compare/studio-0.3.3-alpha...v3.12.1) (2026-04-27)

- Service: `repository`
- Release channel: stable
- Tag: `v3.12.1`

## [0.3.3+alpha](https://github.com/xylex-group/athena/compare/v3.12.0...studio-0.3.3-alpha) (2026-04-27)

- Service: `studio`
- Release channel: experimental
- Tag: `studio-0.3.3-alpha`

## [3.12.0](https://github.com/xylex-group/athena/compare/v3.11.1...v3.12.0) (2026-04-27)

- Service: `repository`
- Release channel: stable
- Tag: `v3.12.0`

## [3.11.1](https://github.com/xylex-group/athena/compare/v3.11.0...v3.11.1) (2026-04-26)

- Service: `repository`
- Release channel: stable
- Tag: `v3.11.1`

## [3.11.0](https://github.com/xylex-group/athena/compare/v3.10.0...v3.11.0) (2026-04-26)

- Service: `repository`
- Release channel: stable
- Tag: `v3.11.0`

## [3.10.0](https://github.com/xylex-group/athena/compare/v3.9.0...v3.10.0) (2026-04-24)

- Service: `repository`
- Release channel: stable
- Tag: `v3.10.0`

## [3.9.0](https://github.com/xylex-group/athena/compare/v3.8.0-exp...v3.9.0) (2026-04-23)

- Service: `repository`
- Release channel: stable
- Tag: `v3.9.0`

## [3.8.0-exp](https://github.com/xylex-group/athena/compare/v3.7.0...v3.8.0-exp) (2026-04-22)

- Service: `repository`
- Release channel: experimental
- Tag: `v3.8.0-exp`

## [3.7.0](https://github.com/xylex-group/athena/compare/studio-0.3.2-alpha...v3.7.0) (2026-04-21)

- Service: `repository`
- Release channel: stable
- Tag: `v3.7.0`

## [0.3.2+alpha](https://github.com/xylex-group/athena/compare/docs-v0.1.1-alpha.1...studio-0.3.2-alpha) (2026-04-20)

- Service: `studio`
- Release channel: experimental
- Tag: `studio-0.3.2-alpha`

## [0.1.1-alpha.1](https://github.com/xylex-group/athena/compare/v3.6.2...docs-v0.1.1-alpha.1) (2026-04-19)

- Service: `docs`
- Release channel: experimental
- Tag: `docs-v0.1.1-alpha.1`

## [3.6.2](https://github.com/xylex-group/athena/compare/v3.6.0-exp.1...v3.6.2) (2026-04-18)

- Service: `repository`
- Release channel: stable
- Tag: `v3.6.2`

## [3.6.0-exp.1](https://github.com/xylex-group/athena/compare/studio-v0.3.1-alpha...v3.6.0-exp.1) (2026-04-18)

- Service: `repository`
- Release channel: experimental
- Tag: `v3.6.0-exp.1`

## [0.3.1+alpha](https://github.com/xylex-group/athena/compare/v3.5.0...studio-v0.3.1-alpha) (2026-04-17)

- Service: `studio`
- Release channel: experimental
- Tag: `studio-v0.3.1-alpha`

## [3.5.0](https://github.com/xylex-group/athena/compare/v3.4.7...v3.5.0) (2026-04-17)

- Service: `repository`
- Release channel: stable
- Tag: `v3.5.0`

## [3.4.7](https://github.com/xylex-group/athena/compare/v3.4.6...v3.4.7) (2026-04-17)

- Service: `repository`
- Release channel: stable
- Tag: `v3.4.7`

## [3.4.6](https://github.com/xylex-group/athena/compare/v3.4.5...v3.4.6) (2026-04-15)

- Service: `repository`
- Release channel: stable
- Tag: `v3.4.6`

## [3.4.5](https://github.com/xylex-group/athena/compare/v3.4.4...v3.4.5) (2026-04-14)

- Service: `repository`
- Release channel: stable
- Tag: `v3.4.5`

## [3.4.4](https://github.com/xylex-group/athena/compare/v3.4.2...v3.4.4) (2026-04-13)

- Service: `repository`
- Release channel: stable
- Tag: `v3.4.4`

## [3.4.2](https://github.com/xylex-group/athena/compare/v3.4.1...v3.4.2) (2026-04-10)

- Service: `repository`
- Release channel: stable
- Tag: `v3.4.2`

## [3.4.1](https://github.com/xylex-group/athena/compare/v1.1.2...v3.4.1) (2026-04-09)

- Service: `repository`
- Release channel: stable
- Tag: `v3.4.1`

## [1.1.2](https://github.com/xylex-group/athena/compare/v3.3.0...v1.1.2) (2026-04-07)

- Service: `repository`
- Release channel: stable
- Tag: `v1.1.2`

## [3.3.0](https://github.com/xylex-group/athena/compare/v3.2.0...v3.3.0) (2026-04-06)

- Service: `repository`
- Release channel: stable
- Tag: `v3.3.0`

## [3.2.0](https://github.com/xylex-group/athena/compare/v3.0.1...v3.2.0) (2026-04-03)

- Service: `repository`
- Release channel: stable
- Tag: `v3.2.0`

## [3.0.1](https://github.com/xylex-group/athena/compare/v3.0.0-alpha.1...v3.0.1) (2026-04-02)

- Service: `repository`
- Release channel: stable
- Tag: `v3.0.1`

## [3.0.0-alpha.1](https://github.com/xylex-group/athena/compare/studio-v0.3.0-alpha.1...v3.0.0-alpha.1) (2026-04-02)

- Service: `repository`
- Release channel: experimental
- Tag: `v3.0.0-alpha.1`

## [0.3.0-alpha.1](https://github.com/xylex-group/athena/compare/v2.11.2...studio-v0.3.0-alpha.1) (2026-03-31)

- Service: `studio`
- Release channel: experimental
- Tag: `studio-v0.3.0-alpha.1`

## [2.11.2](https://github.com/xylex-group/athena/compare/v2.11.1...v2.11.2) (2026-03-27)

- Service: `repository`
- Release channel: stable
- Tag: `v2.11.2`

## [2.11.1](https://github.com/xylex-group/athena/compare/v2.9.2...v2.11.1) (2026-03-26)

- Service: `repository`
- Release channel: stable
- Tag: `v2.11.1`

## [2.9.2](https://github.com/xylex-group/athena/compare/v2.8.1...v2.9.2) (2026-03-24)

- Service: `repository`
- Release channel: stable
- Tag: `v2.9.2`

## [2.8.1](https://github.com/xylex-group/athena/compare/v2.8.0...v2.8.1) (2026-03-22)

- Service: `repository`
- Release channel: stable
- Tag: `v2.8.1`

## [2.8.0](https://github.com/xylex-group/athena/compare/v4.3.7...v2.8.0) (2026-03-22)

- Service: `repository`
- Release channel: stable
- Tag: `v2.8.0`

## [4.3.7](https://github.com/xylex-group/athena/compare/v2.6.0...v4.3.7) (2026-03-22)

- Service: `repository`
- Release channel: stable
- Tag: `v4.3.7`

## [2.6.0](https://github.com/xylex-group/athena/compare/v2.5.8...v2.6.0) (2026-03-21)

- Service: `repository`
- Release channel: stable
- Tag: `v2.6.0`

## [2.5.8](https://github.com/xylex-group/athena/compare/v2.5.7...v2.5.8) (2026-03-21)

- Service: `repository`
- Release channel: stable
- Tag: `v2.5.8`

## [2.5.7](https://github.com/xylex-group/athena/compare/v2.5.6...v2.5.7) (2026-03-19)

- Service: `repository`
- Release channel: stable
- Tag: `v2.5.7`

## [2.5.6](https://github.com/xylex-group/athena/compare/v2.5.5...v2.5.6) (2026-03-19)

- Service: `repository`
- Release channel: stable
- Tag: `v2.5.6`

## [2.5.5](https://github.com/xylex-group/athena/compare/v2.5.4...v2.5.5) (2026-03-18)

- Service: `repository`
- Release channel: stable
- Tag: `v2.5.5`

## [2.5.4](https://github.com/xylex-group/athena/compare/v2.5.2...v2.5.4) (2026-03-18)

- Service: `repository`
- Release channel: stable
- Tag: `v2.5.4`

## [2.5.2](https://github.com/xylex-group/athena/compare/studio-v1.2.0...v2.5.2) (2026-03-18)

- Service: `repository`
- Release channel: stable
- Tag: `v2.5.2`

## [1.2.0](https://github.com/xylex-group/athena/compare/v2.4.0-exp+1...studio-v1.2.0) (2026-03-14)

- Service: `studio`
- Release channel: stable
- Tag: `studio-v1.2.0`

## [2.4.0-exp+1](https://github.com/xylex-group/athena/compare/v2.3.0...v2.4.0-exp+1) (2026-03-14)

- Service: `repository`
- Release channel: experimental
- Tag: `v2.4.0-exp+1`

## [2.3.0](https://github.com/xylex-group/athena/compare/v2.2.1...v2.3.0) (2026-03-13)

- Service: `repository`
- Release channel: stable
- Tag: `v2.3.0`

## [2.2.1](https://github.com/xylex-group/athena/compare/v1.0.4...v2.2.1) (2026-03-13)

- Service: `repository`
- Release channel: stable
- Tag: `v2.2.1`

## [1.0.4](https://github.com/xylex-group/athena/compare/v1.3.0...v1.0.4) (2026-03-11)

- Service: `repository`
- Release channel: stable
- Tag: `v1.0.4`

## [1.3.0](https://github.com/xylex-group/athena/compare/v1.2.1...v1.3.0) (2026-03-08)

- Service: `repository`
- Release channel: stable
- Tag: `v1.3.0`

## [1.2.1](https://github.com/xylex-group/athena/compare/v1.2.0...v1.2.1) (2026-03-04)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.1`

## [1.2.0](https://github.com/xylex-group/athena/compare/v1.1.0...v1.2.0) (2026-03-03)

- Service: `repository`
- Release channel: stable
- Tag: `v1.2.0`

## [1.1.0](https://github.com/xylex-group/athena/compare/v2.0.0...v1.1.0) (2026-03-03)

- Service: `repository`
- Release channel: stable
- Tag: `v1.1.0`

## [2.0.0](https://github.com/xylex-group/athena/compare/v1.0.0...v2.0.0) (2026-03-03)

- Service: `repository`
- Release channel: stable
- Tag: `v2.0.0`

## [1.0.0](https://github.com/xylex-group/athena/compare/v0.83.1...v1.0.0) (2026-03-03)

- Service: `repository`
- Release channel: stable
- Tag: `v1.0.0`

## [0.83.1](https://github.com/xylex-group/athena/compare/v0.83.0...v0.83.1) (2026-03-02)

- Service: `repository`
- Release channel: stable
- Tag: `v0.83.1`

## [0.83.0](https://github.com/xylex-group/athena/compare/v0.1.0...v0.83.0) (2026-03-02)

- Service: `repository`
- Release channel: stable
- Tag: `v0.83.0`

## [0.1.0](https://github.com/xylex-group/athena/compare/v0.82.4...v0.1.0) (2026-03-02)

- Service: `repository`
- Release channel: stable
- Tag: `v0.1.0`

## [0.82.4](https://github.com/xylex-group/athena/compare/v0.82.3...v0.82.4) (2026-02-24)

- Service: `repository`
- Release channel: stable
- Tag: `v0.82.4`

## [0.82.3](https://github.com/xylex-group/athena/compare/v0.82.2...v0.82.3) (2026-02-24)

- Service: `repository`
- Release channel: stable
- Tag: `v0.82.3`

## [0.82.2](https://github.com/xylex-group/athena/compare/v0.82.1...v0.82.2) (2026-02-24)

- Service: `repository`
- Release channel: stable
- Tag: `v0.82.2`

## [0.82.1](https://github.com/xylex-group/athena/compare/v0.82.0...v0.82.1) (2026-02-24)

- Service: `repository`
- Release channel: stable
- Tag: `v0.82.1`

## [0.82.0](https://github.com/xylex-group/athena/compare/v0.80.2...v0.82.0) (2026-02-24)

- Service: `repository`
- Release channel: stable
- Tag: `v0.82.0`

## [0.80.2](https://github.com/xylex-group/athena/compare/v1.0.1...v0.80.2) (2026-02-22)

- Service: `repository`
- Release channel: stable
- Tag: `v0.80.2`

## [1.0.1](https://github.com/xylex-group/athena/compare/v0.1.1...v1.0.1) (2026-02-21)

- Service: `repository`
- Release channel: stable
- Tag: `v1.0.1`

## [0.1.1](https://github.com/xylex-group/athena/compare/v0.80.1...v0.1.1) (2026-02-21)

- Service: `repository`
- Release channel: stable
- Tag: `v0.1.1`

## [0.80.1](https://github.com/xylex-group/athena/compare/v0.2.1...v0.80.1) (2026-02-20)

- Service: `repository`
- Release channel: stable
- Tag: `v0.80.1`

## [0.2.1](https://github.com/xylex-group/athena/compare/v0.79.12...v0.2.1) (2026-02-21)

- Service: `repository`
- Release channel: stable
- Tag: `v0.2.1`

## [0.79.12](https://github.com/xylex-group/athena/compare/v0.79.11...v0.79.12) (2026-02-20)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.12`

## [0.79.11](https://github.com/xylex-group/athena/compare/v0.79.10...v0.79.11) (2026-02-20)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.11`

## [0.79.10](https://github.com/xylex-group/athena/compare/v0.79.8...v0.79.10) (2026-02-20)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.10`

## [0.79.8](https://github.com/xylex-group/athena/compare/v0.79.7...v0.79.8) (2026-02-19)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.8`

## [0.79.7](https://github.com/xylex-group/athena/compare/v0.79.6...v0.79.7) (2026-02-18)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.7`

## [0.79.6](https://github.com/xylex-group/athena/compare/v0.79.5...v0.79.6) (2026-02-18)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.6`

## [0.79.5](https://github.com/xylex-group/athena/compare/v0.79.4...v0.79.5) (2026-02-18)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.5`

## [0.79.4](https://github.com/xylex-group/athena/compare/v0.79.2...v0.79.4) (2026-02-17)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.4`

## [0.79.2](https://github.com/xylex-group/athena/compare/v0.78.0...v0.79.2) (2026-02-16)

- Service: `repository`
- Release channel: stable
- Tag: `v0.79.2`

## [0.78.0](https://github.com/xylex-group/athena/compare/v0.77.1...v0.78.0) (2026-02-13)

- Service: `repository`
- Release channel: stable
- Tag: `v0.78.0`

## [0.77.1](https://github.com/xylex-group/athena/compare/v0.75.1...v0.77.1) (2026-02-09)

- Service: `repository`
- Release channel: stable
- Tag: `v0.77.1`

## [0.75.1](https://github.com/xylex-group/athena/compare/v0.75.0...v0.75.1) (2026-01-30)

- Service: `repository`
- Release channel: stable
- Tag: `v0.75.1`

## [0.75.0](https://github.com/xylex-group/athena/compare/v0.74.1...v0.75.0) (2026-01-30)

- Service: `repository`
- Release channel: stable
- Tag: `v0.75.0`

## [0.74.1](https://github.com/xylex-group/athena/compare/v0.74.0...v0.74.1) (2026-01-28)

- Service: `repository`
- Release channel: stable
- Tag: `v0.74.1`

## [0.74.0](https://github.com/xylex-group/athena/compare/v0.73.5...v0.74.0) (2026-01-28)

- Service: `repository`
- Release channel: stable
- Tag: `v0.74.0`

## [0.73.5](https://github.com/xylex-group/athena/compare/v0.73.4...v0.73.5) (2026-01-28)

- Service: `repository`
- Release channel: stable
- Tag: `v0.73.5`

## [0.73.4](https://github.com/xylex-group/athena/compare/v0.72.3...v0.73.4) (2026-01-27)

- Service: `repository`
- Release channel: stable
- Tag: `v0.73.4`

## [0.72.3](https://github.com/xylex-group/athena/compare/v0.73.1...v0.72.3) (2026-01-27)

- Service: `repository`
- Release channel: stable
- Tag: `v0.72.3`

## [0.73.1](https://github.com/xylex-group/athena/compare/v0.71.0...v0.73.1) (2026-01-27)

- Service: `repository`
- Release channel: stable
- Tag: `v0.73.1`

## [0.71.0](https://github.com/xylex-group/athena/releases/tag/v0.71.0) (2026-01-25)

- Service: `repository`
- Release channel: stable
- Tag: `v0.71.0`

