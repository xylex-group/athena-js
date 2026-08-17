# Athena JWT tokens

Athena sessions stay authoritative. `getToken()` asks the Auth server to project the current session into a short-lived JWT that JWKS consumers (Neon, Gateway, custom APIs) can verify.

This is **not** `getAccessToken()`, which still fetches linked OAuth-provider tokens.

```ts
const { data, error } = await athena.auth.getToken({
  audience: "neon",
});

const neon = athena.auth.tokenProvider({ audience: "neon" });
const cached = await neon.getToken();
```

Configure the Auth service with `ATHENA_AUTH_JWT_ENABLED`, `ATHENA_AUTH_ISSUER`, `ATHENA_AUTH_JWT_AUDIENCES`, and ES256 (or EdDSA) keys. Point Neon at:

```text
https://auth.example.com/.well-known/jwks.json
```

Private signing keys never ship in browser bundles. The JS helper only calls `POST /token` and decodes `exp` for refresh timing.