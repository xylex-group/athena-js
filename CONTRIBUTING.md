# Contributing

Thanks for considering a contribution to `athena-js`. This guide covers the local setup and checks we run before merge.

## Development setup

```bash
git clone https://github.com/xylex-group/athena-js
cd athena-js

npm install
npm run build
```

## Project structure

```
athena-js/
├── src/
│   ├── gateway/     # HTTP client, React hook, types
│   └── supabase.ts   # Athena query builder
├── docs/
└── test/
```

## coding style

- **no emojis** in code or docs
- **casual docs** — explain like to a colleague
- **typescript strict** — all code must pass strict type checking

## Validation checks

Run these before opening a PR:

```bash
pnpm typecheck
pnpm check:all
```

`check:all` runs lint, typecheck, tests, and build.

## Pull requests

1. fork the repo
2. create a feature branch
3. make your changes
4. run `pnpm check:all`
5. push and open a PR

## License

By contributing, you agree your contributions will be licensed under the MIT License.
