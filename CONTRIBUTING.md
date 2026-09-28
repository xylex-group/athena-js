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
pnpm finality
pnpm test:finality
pnpm release:verify
```

`finality` and `test:finality` are the same orchestrator (`scripts/run-finality.mjs`)
against the tracked matrix in `scripts/finality-matrix.mjs`. The run is fail-closed
and ordered (typecheck → unit → ownership → build → exports → browser/RN/Auth UI
export graph → create-athena-app fixture → packed tarball consumer → ephemeral
Postgres → Next embedded E2E → packed golden path / social / passkey → docs
drift → cleanup). PostgreSQL uses `ATHENA_TEST_DATABASE_URL` or `DATABASE_URL`,
otherwise Docker/Podman auto-launch. `release:verify` adds the Auth schema lock
plus `test:tarball` and `test:examples` with the same hard gates. Red cannot
release; green is releasable.

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
