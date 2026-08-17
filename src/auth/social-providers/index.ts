/**
 * Public surface for social OAuth providers.
 *
 * Registry: `./registry.ts`
 * Helpers: `./helpers/*`
 * Providers: one module (or folder) per provider id
 *
 * ## Provider id types
 *
 * - {@link SocialProvider} — open registry id (factories in `socialProviders`,
 *   autocomplete + custom strings via `(string & {})`).
 * - {@link AuthSocialProvider} / {@link AuthOAuthProvider} — auth **API** provider
 *   ids for `signIn.social` / link flows (re-exported from auth types, not redefined).
 */

/**
 * Auth client / API social provider id (`signIn.social`, server `socialProviders` map).
 * Built-ins include `google` | `apple` | `microsoft` | `github` | `discord` | `athena` | `saml`
 * plus declaration-merge extensions. Prefer this for auth routes, not for factory keys alone.
 *
 * @see {@link AuthOAuthProvider} — same set without `saml`
 * @see {@link SocialProvider} — wider OAuth factory registry id
 */
export type {
  AthenaAuthSocialProviderExtensions,
  AuthOAuthProvider,
  AuthSocialProvider,
  AuthSocialProviderBuiltin,
} from "../types.ts";
export type { AccountStatus } from "./account-status.ts";
export * from "./apple.ts";
export * from "./athena.ts";
export * from "./atlassian.ts";
export * from "./cognito.ts";
export * from "./discord.ts";
export * from "./dropbox.ts";
export * from "./facebook.ts";
export * from "./figma.ts";
export * from "./github.ts";
export * from "./gitlab.ts";
export * from "./google.ts";
export * from "./helpers/index.ts";
export * from "./huggingface.ts";
export * from "./kakao.ts";
export * from "./kick.ts";
export * from "./line.ts";
export * from "./linear.ts";
export * from "./linkedin.ts";
export * from "./microsoft-entra-id.ts";
export * from "./naver.ts";
export * from "./notion.ts";
export * from "./paybin.ts";
export * from "./paypal.ts";
export * from "./polar.ts";
export * from "./railway.ts";
export * from "./reddit.ts";
export {
  type SocialProvider,
  type SocialProviderList,
  SocialProviderListEnum,
  type SocialProviders,
  socialProviderList,
  socialProviders,
} from "./registry.ts";
export * from "./roblox.ts";
export * from "./salesforce.ts";
export * from "./slack.ts";
export * from "./spotify.ts";
export * from "./tiktok.ts";
export * from "./twitch.ts";
export * from "./twitter.ts";
export * from "./vercel.ts";
export * from "./vk.ts";
export * from "./wechat.ts";
export * from "./zoom.ts";
