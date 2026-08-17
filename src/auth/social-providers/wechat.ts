import { athenaFetch as betterFetch } from "../fetch.ts";
import type {
  OAuth2Tokens,
  OAuthProvider,
  ProviderOptions,
} from "../oauth2/index.ts";

/**
 * WeChat user profile information
 * @see https://developers.weixin.qq.com/doc/oplatform/en/Website_App/WeChat_Login/Wechat_Login.html
 */
export interface WeChatProfile extends Record<string, unknown> {
  /** @note Email is currently unsupported by WeChat */
  email?: string;
  /**
   * User's avatar image URL
   */
  headimgurl: string;
  /**
   * User's nickname
   */
  nickname: string;
  /**
   * User's unique OpenID
   */
  openid: string;
  /**
   * User's privileges
   */
  privilege: string[];
  /**
   * User's UnionID (unique across the developer's various applications)
   */
  unionid?: string;
}

export interface WeChatOptions extends ProviderOptions<WeChatProfile> {
  /**
   * WeChat App ID
   */
  clientId: string;
  /**
   * WeChat App Secret
   */
  clientSecret: string;

  /**
   * UI language for the WeChat login page
   * cn for Simplified Chinese, en for English
   * @default "cn" if left undefined
   */
  lang?: "cn" | "en";
  /**
   * Platform type for WeChat login
   * - Currently only supports "WebsiteApp" for WeChat Website Application (网站应用)
   * @default "WebsiteApp"
   */
  platformType?: "WebsiteApp";
}

export const wechat = (options: WeChatOptions) => {
  return {
    createAuthorizationURL({ state, scopes, redirectURI }) {
      const _scopes = options.disableDefaultScope ? [] : ["snsapi_login"];
      if (options.scope) {
        _scopes.push(...options.scope);
      }
      if (scopes) {
        _scopes.push(...scopes);
      }

      // WeChat uses non-standard OAuth2 parameters (appid instead of client_id)
      // and requires a fragment (#wechat_redirect), so we construct the URL manually.
      const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
      url.searchParams.set("scope", _scopes.join(","));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("appid", options.clientId);
      url.searchParams.set("redirect_uri", options.redirectURI || redirectURI);
      url.searchParams.set("state", state);
      url.searchParams.set("lang", options.lang || "cn");
      url.hash = "wechat_redirect";

      return url;
    },

    async getUserInfo(token) {
      if (options.getUserInfo) {
        return options.getUserInfo(token);
      }

      const openid = (token as OAuth2Tokens & { openid?: string }).openid;

      if (!openid) {
        return null;
      }

      const params = new URLSearchParams({
        access_token: token.accessToken || "",
        lang: "zh_CN",
        openid,
      });

      const { data: profile, error } = await betterFetch<
        WeChatProfile & { errcode?: number; errmsg?: string }
      >(`https://api.weixin.qq.com/sns/userinfo?${params.toString()}`, {
        method: "GET",
      });

      if (error || !profile || profile.errcode) {
        return null;
      }

      const userMap = await options.mapProfileToUser?.(profile);
      return {
        data: profile,
        user: {
          // WeChat does not return an email, and the OAuth callback rejects a
          // missing one, so the default sign-in would always fail. Synthesize a
          // stable, non-routable placeholder (RFC 2606 `.invalid`) keyed to the
          // user's WeChat id, left unverified. Applications that collect a real
          // email override it via `mapProfileToUser`.
          email:
            profile.email ||
            `${profile.unionid || profile.openid || openid}@wechat.invalid`,
          emailVerified: false,
          id: profile.unionid || profile.openid || openid,
          image: profile.headimgurl,
          name: profile.nickname,
          ...userMap,
        },
      };
    },
    id: "wechat",
    name: "WeChat",
    options,

    refreshAccessToken: options.refreshAccessToken
      ? options.refreshAccessToken
      : async (refreshToken) => {
          const params = new URLSearchParams({
            appid: options.clientId,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          });

          const { data: tokenData, error } = await betterFetch<{
            access_token: string;
            expires_in: number;
            refresh_token: string;
            openid: string;
            scope: string;
            errcode?: number;
            errmsg?: string;
          }>(
            "https://api.weixin.qq.com/sns/oauth2/refresh_token?" +
              params.toString(),
            {
              method: "GET",
            }
          );

          if (error || !tokenData || tokenData.errcode) {
            throw new Error(
              `Failed to refresh access token: ${tokenData?.errmsg || error?.message || "Unknown error"}`
            );
          }

          return {
            accessToken: tokenData.access_token,
            accessTokenExpiresAt: new Date(
              Date.now() + tokenData.expires_in * 1000
            ),
            refreshToken: tokenData.refresh_token,
            scopes: tokenData.scope.split(","),
            tokenType: "Bearer" as const,
          };
        },

    // WeChat uses non-standard token exchange (appid/secret instead of
    // client_id/client_secret, GET instead of POST), so shared helpers
    // like validateAuthorizationCode/getOAuth2Tokens cannot be used directly.
    validateAuthorizationCode: async ({ code }) => {
      const params = new URLSearchParams({
        appid: options.clientId,
        code,
        grant_type: "authorization_code",
        secret: options.clientSecret,
      });

      const { data: tokenData, error } = await betterFetch<{
        access_token: string;
        expires_in: number;
        refresh_token: string;
        openid: string;
        scope: string;
        unionid?: string;
        errcode?: number;
        errmsg?: string;
      }>(
        "https://api.weixin.qq.com/sns/oauth2/access_token?" +
          params.toString(),
        {
          method: "GET",
        }
      );

      if (error || !tokenData || tokenData.errcode) {
        throw new Error(
          `Failed to validate authorization code: ${tokenData?.errmsg || error?.message || "Unknown error"}`
        );
      }

      return {
        accessToken: tokenData.access_token,
        accessTokenExpiresAt: new Date(
          Date.now() + tokenData.expires_in * 1000
        ),
        // WeChat requires openid for the userinfo endpoint, which is
        // returned alongside the access token.
        openid: tokenData.openid,
        refreshToken: tokenData.refresh_token,
        scopes: tokenData.scope.split(","),
        tokenType: "Bearer" as const,
        unionid: tokenData.unionid,
      };
    },
  } satisfies OAuthProvider<WeChatProfile, WeChatOptions>;
};
