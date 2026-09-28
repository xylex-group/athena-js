# next-minimal-golden

Packed next-minimal golden-path fixture for `test:finality`.

Starts from an empty PostgreSQL database, runs application SQL that
references pending Embedded Auth tables, and boots Auth + Embedded
Notifications HTTP from packed `@xylex-group/athena` — never
`packages/athena-js/src/`.

`server.mjs` dispatches `/api/auth/*`, `/api/athena/billing`,
`/api/athena/storage`, and `/api/athena/notifications` through
`createAthenaNextHandler`. Set `ATHENA_GOLDEN_FAIL_APPLY_MANY_ON`
to the 1-based `notifications.preferences.applyMany` POST that should
return 503 `ATHENA_NOTIFICATIONS_UNAVAILABLE` before the handler writes.

`test/finality/next-minimal-golden-path.test.ts` proves empty Postgres → packed migrate (Auth first) → assignment snapshot. `test/finality/next-minimal-golden-social.test.ts` proves packed Social OAuth against `test/fixtures/oauth-provider`. `test/finality/next-minimal-golden-passkey.test.ts` proves passkey onboarding advertisement and registration options. Live Google/GitHub and physical authenticators are not required.
