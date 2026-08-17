import * as z from "zod";
import type { AwaitableFunction } from "../types/index.ts";
import { apple } from "./apple.ts";
import { athena } from "./athena.ts";
import { atlassian } from "./atlassian.ts";
import { cognito } from "./cognito.ts";
import { discord } from "./discord.ts";
import { dropbox } from "./dropbox.ts";
import { facebook } from "./facebook.ts";
import { figma } from "./figma.ts";
import { github } from "./github.ts";
import { gitlab } from "./gitlab.ts";
import { google } from "./google.ts";
import { huggingface } from "./huggingface.ts";
import { kakao } from "./kakao.ts";
import { kick } from "./kick.ts";
import { line } from "./line.ts";
import { linear } from "./linear.ts";
import { linkedin } from "./linkedin.ts";
import { microsoft } from "./microsoft-entra-id.ts";
import { naver } from "./naver.ts";
import { notion } from "./notion.ts";
import { paybin } from "./paybin.ts";
import { paypal } from "./paypal.ts";
import { polar } from "./polar.ts";
import { railway } from "./railway.ts";
import { reddit } from "./reddit.ts";
import { roblox } from "./roblox.ts";
import { salesforce } from "./salesforce.ts";
import { slack } from "./slack.ts";
import { spotify } from "./spotify.ts";
import { tiktok } from "./tiktok.ts";
import { twitch } from "./twitch.ts";
import { twitter } from "./twitter.ts";
import { vercel } from "./vercel.ts";
import { vk } from "./vk.ts";
import { wechat } from "./wechat.ts";
import { zoom } from "./zoom.ts";

/**
 * Built-in social / OAuth provider factories (Better Auth–compatible shape).
 * Includes first-party `athena` for the upcoming Athena Auth identity provider.
 */
export const socialProviders = {
  apple,
  athena,
  atlassian,
  cognito,
  discord,
  dropbox,
  facebook,
  figma,
  github,
  gitlab,
  google,
  huggingface,
  kakao,
  kick,
  line,
  linear,
  linkedin,
  microsoft,
  naver,
  notion,
  paybin,
  paypal,
  polar,
  railway,
  reddit,
  roblox,
  salesforce,
  slack,
  spotify,
  tiktok,
  twitch,
  twitter,
  vercel,
  vk,
  wechat,
  zoom,
};

/** Runtime list of built-in provider ids (includes `athena`). */
export const socialProviderList = Object.keys(socialProviders) as [
  "github",
  ...(keyof typeof socialProviders)[],
];

/**
 * Zod schema for a social provider id: any built-in key or open string
 * (custom providers via `(string & {})`).
 */
export const SocialProviderListEnum = z
  .enum(socialProviderList)
  .or(z.string()) as z.ZodType<SocialProviderList[number] | (string & {})>;

/** Provider id string with autocomplete for built-ins and allowance for custom keys. */
export type SocialProvider = z.infer<typeof SocialProviderListEnum>;

/**
 * Config map for enabling/configuring social providers on an auth instance.
 * Each key is optional; values may be options objects or async factories.
 */
export type SocialProviders = {
  [K in SocialProviderList[number]]?: AwaitableFunction<
    Parameters<(typeof socialProviders)[K]>[0] & {
      enabled?: boolean | undefined;
    }
  >;
};

/** Tuple type of {@link socialProviderList}. */
export type SocialProviderList = typeof socialProviderList;
