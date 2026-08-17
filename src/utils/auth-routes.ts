/**
 * Shared Athena Auth UI route segments, views, and redirect helpers.
 *
 * Aligned with `@xylex-group/athena-auth-ui` / Auth UI `routes.ts` so apps can
 * import from `@xylex-group/athena/utils` instead of copying route maps.
 */

/**
 * Canonical auth screen ids used by UI routing and middleware.
 *
 * Note: the canonical forgot-password view id is `forgot-password`. The URL
 * segment `forget-password` is accepted as a legacy alias and maps to that view.
 */
export type AuthView =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "reset-password"
  | "reset-email-sent"
  | "check-email"
  | "accept-invitation"
  | "logout";

/** Default view when no path segment is present. */
export const AUTH_DEFAULT_VIEW = "sign-in" satisfies AuthView;

/** Optional two-factor path segment used by some app routers. */
export const AUTH_TWO_FACTOR_SEGMENT = "two-factor";

/**
 * Map of URL path segments → {@link AuthView}.
 *
 * Includes `forget-password` as a legacy alias for `forgot-password`.
 */
export const AUTH_VIEW_BY_SEGMENT: Readonly<Record<string, AuthView>> = {
  "accept-invitation": "accept-invitation",
  "check-email": "check-email",
  "forget-password": "forgot-password",
  "forgot-password": "forgot-password",
  logout: "logout",
  "reset-email-sent": "reset-email-sent",
  "reset-password": "reset-password",
  "sign-in": "sign-in",
  "sign-up": "sign-up",
} as const;

/**
 * Views that should bounce **authenticated** users away (e.g. to app home).
 * Reset/check-email/logout stay reachable while signed in.
 */
export const AUTHENTICATED_REDIRECT_VIEW_SET = new Set<AuthView>([
  "sign-in",
  "sign-up",
  "forgot-password",
]);

/**
 * Resolve an auth UI view from a single path segment.
 *
 * @param segment - e.g. `"sign-in"` from `/auth/[segment]`; `undefined` → default
 * @returns Canonical {@link AuthView}, or `null` when the segment is unknown
 *
 * @example
 * ```ts
 * resolveAuthViewFromSegment(undefined) // "sign-in"
 * resolveAuthViewFromSegment("forget-password") // "forgot-password"
 * resolveAuthViewFromSegment("unknown") // null
 * ```
 */
export function resolveAuthViewFromSegment(
  segment: string | undefined
): AuthView | null {
  if (!segment) {
    return AUTH_DEFAULT_VIEW;
  }
  return AUTH_VIEW_BY_SEGMENT[segment] ?? null;
}

/**
 * Whether an authenticated user should be redirected away from this auth view.
 *
 * @param view - Resolved auth view
 */
export function shouldRedirectAuthenticatedAuthView(view: AuthView): boolean {
  return AUTHENTICATED_REDIRECT_VIEW_SET.has(view);
}

/**
 * Default page routes under `/auth/*` for Next.js (or similar) apps.
 */
export const AUTH_ROUTES = {
  acceptInvitation: "/auth/accept-invitation",
  appHome: "/",
  checkEmail: "/auth/check-email",
  forgotPassword: "/auth/forgot-password",
  logout: "/auth/logout",
  resetEmailSent: "/auth/reset-email-sent",
  resetPassword: "/auth/reset-password",
  signIn: "/auth/sign-in",
  signUp: "/auth/sign-up",
  socialCallback: "/auth/social-callback",
} as const;

export type AuthRoutes = Record<keyof typeof AUTH_ROUTES, string>;

/**
 * Build an auth route map with optional path overrides.
 */
export function createAuthRoutes(
  overrides: Partial<AuthRoutes> = {}
): AuthRoutes {
  return {
    ...AUTH_ROUTES,
    ...overrides,
  };
}

/**
 * Query/mode → path redirects used by legacy `?mode=` style entrypoints.
 */
export interface AuthModeRedirects {
  readonly "forgot-password": string;
  readonly login: string;
  readonly logout: string;
  readonly "reset-password": string;
  readonly signup: string;
}

export function createAuthModeRedirects(
  routes: AuthRoutes = AUTH_ROUTES
): AuthModeRedirects {
  return {
    "forgot-password": routes.forgotPassword,
    login: routes.signIn,
    logout: routes.logout,
    "reset-password": routes.resetPassword,
    signup: routes.signUp,
  };
}

export const AUTH_MODE_REDIRECTS = createAuthModeRedirects();

export type AuthMode = keyof AuthModeRedirects;

export const AUTH_MODE_SET = new Set<string>(Object.keys(AUTH_MODE_REDIRECTS));

export const AUTHENTICATED_REDIRECT_MODE_SET = new Set<AuthMode>([
  "login",
  "signup",
  "forgot-password",
]);

/**
 * Type guard for legacy auth `mode` query values (`login`, `signup`, …).
 */
export function isAuthMode(value: string): value is AuthMode {
  return AUTH_MODE_SET.has(value);
}

/**
 * Whether an authenticated user should be redirected away from this auth mode.
 */
export function shouldRedirectAuthenticatedAuthMode(mode: AuthMode): boolean {
  return AUTHENTICATED_REDIRECT_MODE_SET.has(mode);
}

/**
 * Resolve a path for a legacy auth mode string.
 *
 * @returns Path from {@link AUTH_MODE_REDIRECTS}, or `null` if unknown
 */
export function resolveAuthModeRedirect(
  mode: string | undefined,
  redirects: AuthModeRedirects = AUTH_MODE_REDIRECTS
): string | null {
  if (!(mode && isAuthMode(mode))) {
    return null;
  }
  return redirects[mode];
}
