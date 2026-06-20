import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    browser: 'src/browser.ts',
    react: 'src/react/index.ts',
    'next/client': 'src/next/client.ts',
    'next/server': 'src/next/server.ts',
    cookies: 'src/cookies/index.ts',
    utils: 'src/utils/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
})
