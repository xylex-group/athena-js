# Athena Expo 53 / React Native 0.79 packed fixture

This fixture installs the generated Athena tarball instead of resolving the
workspace package. It exercises the documented React Native subpath with Expo
53.0.27, React Native 0.79.6, Hermes, and SecureStore.

```bash
pnpm --dir packages/athena-js pack --pack-destination packages/athena-js/.tmp/packages
pnpm --dir packages/athena-js/test/fixtures/expo-rn53 install
pnpm --dir packages/athena-js/test/fixtures/expo-rn53 check
```

The check covers packed package resolution, TypeScript, Expo Metro loading,
Node/server-only graph exclusions, and production JavaScript exports for both
iOS and Android. It does not require an iOS or Android SDK because `expo
export` produces the platform JavaScript bundles.
