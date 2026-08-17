export type AthenaCookieSameSite = "strict" | "lax" | "none";

export interface AthenaCookieOptions {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  partitioned?: boolean;
  path?: string;
  sameSite?: AthenaCookieSameSite;
  secure?: boolean;
  [key: string]: unknown;
}

export interface AthenaAuthCookie {
  attributes: AthenaCookieOptions;
  name: string;
}

export interface AthenaAuthCookies {
  accountData: AthenaAuthCookie;
  dontRememberToken: AthenaAuthCookie;
  sessionData: AthenaAuthCookie;
  sessionToken: AthenaAuthCookie;
}

export interface AthenaCookieDefinition {
  attributes?: AthenaCookieOptions;
  name?: string;
}

export interface AthenaCookieVersionResolverInput {
  session: Record<string, unknown>;
  user: Record<string, unknown>;
}

export type AthenaCookieVersionResolver =
  | string
  | ((
      session: Record<string, unknown>,
      user: Record<string, unknown>
    ) => string | Promise<string>);

export interface AthenaSessionCookieCacheConfig {
  enabled?: boolean;
  maxAge?: number;
  strategy?: "compact" | "jwt" | "jwe";
  version?: AthenaCookieVersionResolver;
}

export interface AthenaCookieAdvancedOptions {
  cookiePrefix?: string;
  cookies?: Record<string, AthenaCookieDefinition>;
  crossSubDomainCookies?: {
    enabled?: boolean;
    domain?: string;
  };
  defaultCookieAttributes?: AthenaCookieOptions;
  useSecureCookies?: boolean;
}

export interface AthenaCookiesOptions {
  advanced?: AthenaCookieAdvancedOptions;
  baseURL?:
    | string
    | {
        protocol?: "http" | "https" | "auto";
        allowedHosts?: string[];
      };
  session?: {
    expiresIn?: number;
    cookieCache?: AthenaSessionCookieCacheConfig;
  };
}

export interface AthenaSessionPair<
  SessionShape extends Record<string, unknown> = Record<string, unknown>,
  UserShape extends Record<string, unknown> = Record<string, unknown>,
> {
  session: SessionShape & { token: string };
  user: UserShape;
}

export interface AthenaCookieContextRuntime {
  context: {
    secret?: string;
    authCookies: AthenaAuthCookies;
    sessionConfig?: {
      expiresIn?: number;
    };
    options?: {
      session?: {
        cookieCache?: AthenaSessionCookieCacheConfig;
      };
      account?: {
        storeAccountCookie?: boolean;
      };
    };
    setNewSession?: (session: AthenaSessionPair) => void;
  };
  getCookie?: (name: string) => string | null | undefined;
  getSignedCookie?: (
    name: string,
    secret: string
  ) => string | null | Promise<string | null>;
  headers?: Headers;
  logger?: {
    debug?: (event: string, payload?: unknown) => void;
  };
  setCookie: (
    name: string,
    value: string,
    attributes: AthenaCookieOptions
  ) => void;
  setSignedCookie?: (
    name: string,
    value: string,
    secret: string,
    attributes: AthenaCookieOptions
  ) => void | Promise<void>;
}

export interface AthenaGetCookieCacheConfig<
  SessionShape extends Record<string, unknown> = Record<string, unknown>,
  UserShape extends Record<string, unknown> = Record<string, unknown>,
> {
  cookieName?: string;
  cookiePrefix?: string;
  isSecure?: boolean;
  secret?: string;
  strategy?: "compact" | "jwt" | "jwe";
  version?:
    | string
    | ((session: SessionShape, user: UserShape) => string | Promise<string>);
}

export interface AthenaCookieCachePayload<
  SessionShape extends Record<string, unknown> = Record<string, unknown>,
  UserShape extends Record<string, unknown> = Record<string, unknown>,
> {
  session: SessionShape;
  updatedAt: number;
  user: UserShape;
  version?: string;
}
