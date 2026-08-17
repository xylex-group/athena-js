# Auth routes and views

Shared path/view helpers for Athena Auth UI screens, exported from
`@xylex-group/athena/utils`.

Aligned with `@xylex-group/athena-auth-ui` `routes.ts` so Next.js apps can drop
local copies of `AUTH_VIEW_BY_SEGMENT` / `resolveAuthViewFromSegment`.

## Import

```ts
import {
  AUTH_DEFAULT_VIEW,
  AUTH_ROUTES,
  AUTH_VIEW_BY_SEGMENT,
  resolveAuthViewFromSegment,
  shouldRedirectAuthenticatedAuthView,
  shouldRedirectAuthenticatedAuthMode,
  isAuthMode,
  resolveAuthModeRedirect,
  createAuthRoutes,
  type AuthView,
  type AuthMode,
} from "@xylex-group/athena/utils"
```

## Views and segments

```ts
type AuthView =
  | "sign-in"
  | "sign-up"
  | "forgot-password" // canonical
  | "reset-password"
  | "reset-email-sent"
  | "check-email"
  | "accept-invitation"
  | "logout"

// URL segment → view
resolveAuthViewFromSegment(undefined)           // "sign-in" (default)
resolveAuthViewFromSegment("sign-up")           // "sign-up"
resolveAuthViewFromSegment("forget-password")   // "forgot-password" (legacy alias)
resolveAuthViewFromSegment("unknown")           // null
```

### Authenticated redirect

When a user **already has a session**, these views should usually redirect to
the app home instead of showing the form:

```ts
shouldRedirectAuthenticatedAuthView("sign-in")      // true
shouldRedirectAuthenticatedAuthView("sign-up")      // true
shouldRedirectAuthenticatedAuthView("forgot-password") // true
shouldRedirectAuthenticatedAuthView("reset-password")  // false
shouldRedirectAuthenticatedAuthView("logout")          // false
```

### Next.js page example

```ts
// app/auth/[segment]/page.tsx
import {
  resolveAuthViewFromSegment,
  shouldRedirectAuthenticatedAuthView,
  AUTH_ROUTES,
} from "@xylex-group/athena/utils"
import { hasAuthSessionCookie } from "@xylex-group/athena/cookies"
import { redirect, notFound } from "next/navigation"
import { cookies } from "next/headers"

export default async function AuthSegmentPage({
  params,
}: {
  params: Promise<{ segment?: string }>
}) {
  const { segment } = await params
  const view = resolveAuthViewFromSegment(segment)
  if (!view) notFound()

  const cookieHeader = (await cookies()).toString()
  if (
    hasAuthSessionCookie(cookieHeader) &&
    shouldRedirectAuthenticatedAuthView(view)
  ) {
    redirect(AUTH_ROUTES.appHome)
  }

  // render Auth UI for `view`
}
```

## Default routes

```ts
AUTH_ROUTES.signIn          // "/auth/sign-in"
AUTH_ROUTES.forgotPassword  // "/auth/forgot-password"
AUTH_ROUTES.appHome         // "/"
// …
```

Override paths:

```ts
const routes = createAuthRoutes({
  signIn: "/login",
  appHome: "/dashboard",
})
```

## Legacy `?mode=` redirects

```ts
isAuthMode("login") // true
resolveAuthModeRedirect("signup") // "/auth/sign-up"
shouldRedirectAuthenticatedAuthMode("login") // true
```

## Related

- Auth URL helpers: [`athena-auth-url.md`](./athena-auth-url.md)
- Cookie clear / sign-out: [`auth-cookies.md`](./auth-cookies.md)
- Session bridge: [`auth-session-bridge.md`](./auth-session-bridge.md)
