# contributing

thanks for considering contributing to athena-js. heres how to get started.

## development setup

```bash
git clone https://github.com/xylex-group/athena-js
cd athena-js

npm install
npm run build
```

## project structure

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

## pull requests

1. fork the repo
2. create a feature branch
3. make your changes
4. run `npm run build` and `npm run lint`
5. push and open a PR

## license

by contributing, you agree your contributions will be licensed under the MIT license.
