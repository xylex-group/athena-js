# Social providers (`@xylex-group/athena/social-providers`)

Better Auth–compatible OAuth / social identity provider factories for the Athena JS SDK.

## Import

```ts
import {
  socialProviders,
  socialProviderList,
  google,
  github,
  apple,
  athena,
  type SocialProvider,
  type SocialProviders,
  type AuthSocialProvider,
  type AuthOAuthProvider,
  type GoogleOptions,
  type AppleNonConformUser,
  type AccountStatus,
  type AthenaOptions,
  type AthenaProfile,
} from "@xylex-group/athena/social-providers"
```

### Provider id types (single source, no duplicates)

| Type | Meaning |
|------|---------|
| `AuthSocialProvider` | Auth API id for `signIn.social` / link (`google` \| `apple` \| `microsoft` \| `github` \| `discord` \| `athena` \| `saml` + merge extensions) |
| `AuthOAuthProvider` | `Exclude<AuthSocialProvider, "saml">` |
| `SocialProvider` | OAuth **factory** registry key (wide list + open `(string & {})`) |

Defined once in `auth/types.ts`; re-exported here and from `@xylex-group/athena`. Do not redefine a narrower local union unless your app intentionally restricts providers.

Package path: **`@xylex-group/athena/social-providers`**  
Source tree: **`src/auth/social-providers/*`** (mirrors `@better-auth/core` social-providers layout)

## Layout

```
src/auth/
  social-providers/
    index.ts              # public re-exports only
    registry.ts           # socialProviders map + SocialProvider types
    account-status.ts
    helpers/              # shared helpers (JWKS key fetch, scopes, URL trim)
    google.ts / google-types.ts / google-keys.ts / google-verify.ts
    apple.ts / apple-types.ts / apple-keys.ts / apple-crypto.ts
    paypal.ts / paypal-types.ts / paypal-keys.ts
    facebook.ts / facebook-types.ts / facebook-verify.ts
    cognito.ts / cognito-types.ts / cognito-keys.ts
    microsoft-entra-id.ts / microsoft-types.ts / microsoft-keys.ts
    zoom.ts / zoom-types.ts
    …remaining providers as single focused modules
  oauth2/
    types.ts              # OAuth2Tokens, OAuthProvider, ProviderOptions
    create-authorization-url.ts
    validate-authorization-code.ts
    refresh-access-token.ts
    client-credentials-token.ts
    reject-redirects.ts
    pkce.ts / client-id.ts / token-utils.ts
    jwks/                 # cache, fetch, verify-jws, verify-access-token
  types/helper.ts         # Awaitable, Prettify, LiteralUnion, …
  env/                    # logger
  fetch/                  # athenaFetch (native fetch, no better-fetch)
  error/                  # AthenaAuthError, APIError
  utils/base64.ts
```

The public re-export entry is `src/social-providers/index.ts` so `package.json`
`"exports": { "./social-providers": ... }` stays stable while implementation
lives under `auth/`.

## Registry

`socialProviders` is a map of factory functions:

```ts
const provider = socialProviders.google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
})

const url = await provider.createAuthorizationURL({
  state,
  codeVerifier,
  redirectURI: "https://app.example.com/api/auth/callback/google",
})
```

Each factory returns a provider with:

- `id` / `name`
- `createAuthorizationURL`
- `validateAuthorizationCode`
- `getUserInfo`
- optional `refreshAccessToken` / `verifyIdToken`
- `options`

## Athena provider

`athena` / `AthenaOptions` / `AthenaProfile` are first-class entries for the
upcoming Athena Auth identity provider. Configure `issuer` (or full endpoint
overrides); defaults use `{issuer}/oauth2/authorize|token|userinfo`.

```ts
import { athena } from "@xylex-group/athena/social-providers"

const provider = athena({
  clientId: "…",
  clientSecret: "…",
  issuer: "https://auth.example.com",
})
```

## Design notes

| Topic | Approach |
|--------|----------|
| Fetch | Native `fetch` via `athenaFetch` — **not** `@better-fetch/fetch` |
| Errors | `AthenaAuthError` (not `BetterAuthError`) |
| Crypto / JWT | [`jose`](https://github.com/panva/jose) for ID token / JWKS verification |
| Validation | `zod` for `SocialProviderListEnum` |
| Compatibility | Provider file names and exports align with Better Auth so configs port cleanly |

## Built-in providers

`apple`, `atlassian`, `athena`, `cognito`, `discord`, `dropbox`, `facebook`,
`figma`, `github`, `gitlab`, `google`, `huggingface`, `kakao`, `kick`, `line`,
`linear`, `linkedin`, `microsoft`, `naver`, `notion`, `paybin`, `paypal`,
`polar`, `railway`, `reddit`, `roblox`, `salesforce`, `slack`, `spotify`,
`tiktok`, `twitch`, `twitter`, `vercel`, `vk`, `wechat`, `zoom`

## Related types

- `SocialProvider` — open string union of provider ids (autocomplete + custom keys)
- `SocialProviders` — config map shape for enabling providers
- `AccountStatus` — `"pending" \| "active" \| "inactive"` (Zoom account status; general-purpose)
- `AppleNonConformUser` — first-consent Apple `user` payload shape

## License

Same as `@xylex-group/athena` (MIT).
