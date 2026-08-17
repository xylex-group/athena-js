import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider, ProviderOptions } from "../oauth2/index.ts";
import {
  createAuthorizationURL,
  refreshAccessToken,
  validateAuthorizationCode,
} from "../oauth2/index.ts";

interface Partner {
  /** Partner-specific ID (consent required: kakaotalk_message) */
  uuid?: string | undefined;
}

interface Profile {
  /** Whether the profile image is the default */
  is_default_image?: boolean | undefined;
  /** Whether the nickname is the default */
  is_default_nickname?: boolean | undefined;
  /** Nickname (consent required: profile/nickname) */
  nickname?: string | undefined;
  /** Profile image URL (consent required: profile/profile image) */
  profile_image_url?: string | undefined;
  /** Thumbnail image URL (consent required: profile/profile image) */
  thumbnail_image_url?: string | undefined;
}

interface KakaoAccount {
  /** Age range */
  age_range?: string | undefined;
  /** Consent required: age range */
  age_range_needs_agreement?: boolean | undefined;
  /** Birthday (MMDD) */
  birthday?: string | undefined;
  /** Consent required: birthday */
  birthday_needs_agreement?: boolean | undefined;
  /** Birthday type (SOLAR/LUNAR) */
  birthday_type?: string | undefined;
  /** Birth year (YYYY) */
  birthyear?: string | undefined;
  /** Consent required: birth year */
  birthyear_needs_agreement?: boolean | undefined;
  /** CI (unique identifier) */
  ci?: string | undefined;
  /** CI authentication time (UTC) */
  ci_authenticated_at?: string | undefined;
  /** Consent required: CI */
  ci_needs_agreement?: boolean | undefined;
  /** Email */
  email?: string | undefined;
  /** Consent required: email */
  email_needs_agreement?: boolean | undefined;
  /** Gender (male/female) */
  gender?: string | undefined;
  /** Consent required: gender */
  gender_needs_agreement?: boolean | undefined;
  /** Email valid */
  is_email_valid?: boolean | undefined;
  /** Email verified */
  is_email_verified?: boolean | undefined;
  /** Whether birthday is in a leap month */
  is_leap_month?: boolean | undefined;
  /** Name */
  name?: string | undefined;
  /** Consent required: name */
  name_needs_agreement?: boolean | undefined;
  /** Phone number */
  phone_number?: string | undefined;
  /** Consent required: phone number */
  phone_number_needs_agreement?: boolean | undefined;
  /** Profile info */
  profile?: Profile | undefined;
  /** Consent required: profile image */
  profile_image_needs_agreement?: boolean | undefined;
  /** Consent required: profile info (nickname/profile image) */
  profile_needs_agreement?: boolean | undefined;
  /** Consent required: nickname */
  profile_nickname_needs_agreement?: boolean | undefined;
}

export interface KakaoProfile {
  /** UTC datetime when the user connected the service */
  connected_at?: string | undefined;
  /** Partner info */
  for_partner?: Partner | undefined;
  /**
   * Whether the user has signed up (only present if auto-connection is disabled)
   * false: preregistered, true: registered
   */
  has_signed_up?: boolean | undefined;
  /** Kakao user ID */
  id: number;
  /** Kakao account info */
  kakao_account: KakaoAccount;
  /** Custom user properties */
  properties?: Record<string, unknown> | undefined;
  /** UTC datetime when the user signed up via Kakao Sync */
  synched_at?: string | undefined;
}

export interface KakaoOptions extends ProviderOptions<KakaoProfile> {
  clientId: string;
}

export const kakao = (options: KakaoOptions) => {
  const tokenEndpoint = "https://kauth.kakao.com/oauth/token";
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope
        ? []
        : ["account_email", "profile_image", "profile_nickname"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }
      return createAuthorizationURL({
        authorizationEndpoint: "https://kauth.kakao.com/oauth/authorize",
        id: "kakao",
        options,
        redirectURI,
        scopes: _scopes,
        state,
      });
    },
    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }
      const { data: profile, error } = await betterFetch<KakaoProfile>(
        "https://kapi.kakao.com/v2/user/me",
        {
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
          },
        }
      );
      if (error || !profile) {
        return null;
      }
      const userMap = await options.mapProfileToUser?.(profile);
      const account = profile.kakao_account || {};
      const kakaoProfile = account.profile || {};
      const user = {
        email: account.email,
        emailVerified: !!account.is_email_valid && !!account.is_email_verified,
        id: String(profile.id),
        image:
          kakaoProfile.profile_image_url || kakaoProfile.thumbnail_image_url,
        name: kakaoProfile.nickname || account.name || "",
        ...userMap,
      };
      return {
        data: profile,
        user,
      };
    },
    id: "kakao",
    name: "Kakao",
    options,
    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) =>
          refreshAccessToken({
            options: {
              clientId: options.clientId,
              clientKey: options.clientKey,
              clientSecret: options.clientSecret,
            },
            refreshToken,
            tokenEndpoint,
          }),
    validateAuthorizationCode: async ({ code, redirectURI }) =>
      validateAuthorizationCode({
        code,
        options,
        redirectURI,
        tokenEndpoint,
      }),
  } satisfies OAuthProvider<KakaoProfile>;
};
