# next-embedded

Bootable Next-shaped fixture for `test:finality`.

Install the **packed** `@xylex-group/athena` tarball:

```text
pnpm pack --pack-destination .tmp/packages
# install .tmp/packages/*.tgz into this directory
```

Do not import `../../src`. Use `@xylex-group/athena/server`,
`@xylex-group/athena/next/server`, and `@xylex-group/athena/next/client`.

`server.mjs` is the production-like boot (equivalent of `next start`) mounting
`/api/athena` and `/api/auth`.
