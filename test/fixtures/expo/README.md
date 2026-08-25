# Athena Expo / RN fixture

Lean proof that `@xylex-group/athena/react-native` resolves and typechecks without Node polyfills.

## Commands

```bash
pnpm --dir packages/athena-js build
pnpm --dir packages/athena-js/test/fixtures/expo install
pnpm --dir packages/athena-js/test/fixtures/expo check
```

## Scope

| Check | Covered |
| ----- | ------- |
| Subpath export | yes |
| dist present | yes |
| Static Node/DOM ban (audit) | yes |
| Typecheck smoke.ts | yes |
| Biome SSOT (no Prettier) | yes |
| Full Expo Go device run | optional / local |

`metro.config.js` documents Metro expectations; it requires `expo/metro-config` only when you run a full Expo app here.