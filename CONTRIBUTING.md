# Contributing

Thanks for considering a contribution to `athena-js`. This guide covers the local setup and checks we run before merge.

## Development setup

```bash
git clone https://github.com/xylex-group/athena.git
cd athena/packages/athena-js

pnpm install
pnpm build
```

## Project structure

```
athena/
└── packages/
    └── athena-js/
        ├── src/
        ├── docs/
        └── test/
```

## coding style

- **no emojis** in code or docs
- **casual docs** — explain like to a colleague
- **typescript strict** — all code must pass strict type checking

## Validation checks

The release SSOT is local verification, not GitHub CI:

```bash
pnpm test:finality
pnpm release:verify
```

`test:finality` is fail-closed and ordered (typecheck → unit → ownership →
build → exports → browser boundary → create-athena-app fixture → packed
tarball consumer → ephemeral Postgres → Next embedded E2E → cleanup).
PostgreSQL uses `ATHENA_TEST_DATABASE_URL` or `DATABASE_URL`, otherwise
Docker/Podman auto-launch. Red cannot release; green is releasable.

Quick iteration still uses:

```bash
pnpm typecheck
pnpm check:all
```

`check:all` runs lint, typecheck, tests, and build. CI mirrors
`test:finality` / `release:verify`.

## Pull requests

1. fork the repo
2. create a feature branch
3. make your changes
4. run `pnpm check:all` for iteration
5. run `pnpm test:finality` before claiming the change is releasable
6. push and open a PR

CI mirrors `test:finality`; it does not replace it.

## License

By contributing, you agree your contributions will be licensed under the MIT License.
