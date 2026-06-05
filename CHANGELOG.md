# Changelog

## Unreleased

### Notes

- Runtime query/mutation/RPC results now expose structured `error` objects on `AthenaResult<T>` by default, including `message`, `code`, `details`, `hint`, `status`, `statusText`, and normalized metadata such as `kind`/`table`/`operation`.
- `experimental.enableErrorNormalization` is now deprecated and retained as a no-op compatibility flag because failed results inline normalized error data automatically.
- `experimental.findManyAst` now opt-ins clean `findMany(...)` calls to send the original AST body through `/gateway/fetch` for gateways that support direct AST transport.

## [2.2.0](https://github.com/xylex-group/athena-js/compare/v2.1.2...v2.2.0) (2026-06-01)

- Release channel: stable
- Tag: `v2.2.0`

## [2.1.2](https://github.com/xylex-group/athena-js/compare/v2.1.1...v2.1.2) (2026-05-31)

- Release channel: stable
- Tag: `v2.1.2`

## [2.1.1](https://github.com/xylex-group/athena-js/compare/v2.1.0...v2.1.1) (2026-05-30)

- Release channel: stable
- Tag: `v2.1.1`

## [2.1.0](https://github.com/xylex-group/athena-js/compare/v2.0.0...v2.1.0) (2026-05-29)

- Release channel: stable
- Tag: `v2.1.0`

## [2.0.0](https://github.com/xylex-group/athena-js/compare/v1.9.0...v2.0.0) (2026-05-29)

- Release channel: stable
- Tag: `v2.0.0`

## [1.9.0](https://github.com/xylex-group/athena-js/compare/v1.8.0...v1.9.0) (2026-05-24)

- Release channel: stable
- Tag: `v1.9.0`

## [1.8.0](https://github.com/xylex-group/athena-js/compare/v1.7.0...v1.8.0) (2026-05-23)

- Release channel: stable
- Tag: `v1.8.0`

## [1.7.0](https://github.com/xylex-group/athena-js/compare/v1.6.2...v1.7.0) (2026-05-22)

- Release channel: stable
- Tag: `v1.7.0`

## [1.6.2](https://github.com/xylex-group/athena-js/compare/v1.6.1...v1.6.2) (2026-05-17)

- Release channel: stable
- Tag: `v1.6.2`

## [1.6.1](https://github.com/xylex-group/athena-js/compare/v1.6.0...v1.6.1) (2026-05-16)

- Release channel: stable
- Tag: `v1.6.1`

## [1.6.0](https://github.com/xylex-group/athena-js/compare/v1.5.0...v1.6.0) (2026-05-16)

- Release channel: stable
- Tag: `v1.6.0`

## [1.5.0](https://github.com/xylex-group/athena-js/compare/v1.4.1...v1.5.0) (2026-05-10)

- Release channel: stable
- Tag: `v1.5.0`

## [1.4.1](https://github.com/xylex-group/athena-js/compare/v1.4.0...v1.4.1) (2026-04-20)

- Release channel: stable
- Tag: `v1.4.1`

## [1.4.0](https://github.com/xylex-group/athena-js/compare/v1.3.0...v1.4.0) (2026-04-17)

- Release channel: stable
- Tag: `v1.4.0`

## [1.3.0](https://github.com/xylex-group/athena-js/compare/v1.2.0...v1.3.0) (2026-04-17)

- Release channel: stable
- Tag: `v1.3.0`

## [1.2.0](https://github.com/xylex-group/athena-js/compare/v1.1.2...v1.2.0) (2026-04-11)

- Release channel: stable
- Tag: `v1.2.0`

## [1.1.2](https://github.com/xylex-group/athena-js/compare/v1.0.4...v1.1.2) (2026-04-07)

- Release channel: stable
- Tag: `v1.1.2`

## [1.0.4](https://github.com/xylex-group/athena-js/compare/v1.0.1...v1.0.4) (2026-03-11)

- Release channel: stable
- Tag: `v1.0.4`

## [1.0.1](https://github.com/xylex-group/athena-js/compare/v1.0.0...v1.0.1) (2026-02-21)

- Release channel: stable
- Tag: `v1.0.1`

## [1.0.0](https://github.com/xylex-group/athena-js/compare/v0.1.1...v1.0.0) (2026-02-21)

- Release channel: stable
- Tag: `v1.0.0`

## [0.1.1](https://github.com/xylex-group/athena-js/compare/v0.2.1...v0.1.1) (2026-02-21)

- Release channel: stable
- Tag: `v0.1.1`

## [0.2.1](https://github.com/xylex-group/athena-js/releases/tag/v0.2.1) (2026-02-21)

- Release channel: stable
- Tag: `v0.2.1`
