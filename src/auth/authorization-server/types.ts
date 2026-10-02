export type OAuthClientType = "public";
export type OAuthRegistrationKind = "pre-registered";
export type OAuthTokenEndpointAuthMethod = "none";
export type OAuthAuthorizationRequestStatus =
  | "approved"
  | "consumed"
  | "denied"
  | "expired"
  | "pending";
export type OAuthGrantStatus = "active" | "expired" | "revoked";
export type OAuthRefreshTokenStatus =
  | "active"
  | "expired"
  | "reuse_detected"
  | "revoked"
  | "rotated";

export type OidcIdentityScope = "openid" | "profile" | "email";
export type OidcPrompt = "consent" | "login" | "none";

export interface OAuthClient {
  clientName: string;
  clientType: OAuthClientType;
  clientUrl: string | null;
  createdAt: Date;
  grantType: "authorization_code";
  id: string;
  isActive: boolean;
  metadata: Readonly<Record<string, unknown>>;
  redirectUris: readonly string[];
  registrationKind: OAuthRegistrationKind;
  resourceUris: readonly string[];
  responseType: "code";
  scopes: readonly string[];
  tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
  updatedAt: Date;
}

export interface OAuthAuthorizationGrant {
  authorizedAt: Date;
  clientId: string;
  createdAt: Date;
  expiresAt: Date | null;
  id: string;
  identityScopes: readonly OidcIdentityScope[];
  lastUsedAt: Date | null;
  organizationId: string | null;
  resource: string;
  revokedAt: Date | null;
  revokedBy: string | null;
  revokeReason: string | null;
  scopes: readonly string[];
  status: OAuthGrantStatus;
  updatedAt: Date;
  userId: string;
}

export interface OAuthAuthorizationRequest {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  createdAt: Date;
  expiresAt: Date;
  id: string;
  identityScopes: readonly OidcIdentityScope[];
  maxAge: number | null;
  nonce: string | null;
  organizationId: string | null;
  prompt: readonly OidcPrompt[];
  redirectUri: string;
  requestedScopes: readonly string[];
  resolvedAt: Date | null;
  resource: string;
  stateCiphertext: string;
  status: OAuthAuthorizationRequestStatus;
  userId: string | null;
}

export interface OAuthAuthorizationCode {
  authenticatedAt: Date;
  authenticationMethods: readonly string[];
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  consumedAt: Date | null;
  consumeReason: string | null;
  createdAt: Date;
  expiresAt: Date;
  grantId: string;
  id: string;
  identityScopes: readonly OidcIdentityScope[];
  nonce: string | null;
  organizationId: string | null;
  redirectUri: string;
  resource: string;
  scopes: readonly string[];
  userId: string;
}

export interface OAuthRefreshToken {
  clientId: string;
  createdAt: Date;
  expiresAt: Date;
  familyId: string;
  grantId: string;
  id: string;
  identityScopes: readonly OidcIdentityScope[];
  organizationId: string | null;
  parentTokenId: string | null;
  resource: string;
  revokedAt: Date | null;
  revokeReason: string | null;
  rotatedAt: Date | null;
  status: OAuthRefreshTokenStatus;
  scopes: readonly string[];
  usedAt: Date | null;
  userId: string;
}

export interface OAuthRevokedAccessToken {
  expiresAt: Date;
  grantId: string;
  jti: string;
  reason: string | null;
  revokedAt: Date;
}

export interface OAuthAccessTokenClaims {
  aud: string;
  athena_grant_id: string;
  athena_identity_scopes?: readonly OidcIdentityScope[];
  athena_organization_id?: string;
  athena_token_family_id?: string;
  client_id: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  nbf: number;
  scope: string;
  sub: string;
}

export interface AthenaOidcIdTokenClaims {
  amr: readonly string[];
  aud: string;
  auth_time: number;
  exp: number;
  iat: number;
  iss: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  preferred_username?: string;
  sub: string;
}

export interface VerifiedOAuthAccessToken {
  claims: OAuthAccessTokenClaims;
  client: OAuthClient;
  grant: OAuthAuthorizationGrant;
  organizationId: string | null;
  resource: string;
  scopes: readonly string[];
  userId: string;
}
