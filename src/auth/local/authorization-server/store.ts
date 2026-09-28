import type {
  OAuthAuthorizationCode,
  OAuthAuthorizationGrant,
  OAuthAuthorizationRequest,
  OAuthClient,
  OAuthRefreshToken,
  OAuthRevokedAccessToken,
} from "../../authorization-server/types.ts";

export interface CreateOAuthClientInput {
  clientName: string;
  clientType?: "public";
  clientUrl?: string | null;
  id: string;
  metadata?: Record<string, unknown>;
  redirectUris: readonly string[];
  resourceUris: readonly string[];
  scopes: readonly string[];
}

export interface OAuthGrantLookup {
  clientId: string;
  organizationId: string | null;
  resource: string;
  userId: string;
}

export interface AuthorizeOAuthGrantInput extends OAuthGrantLookup {
  scopes: readonly string[];
}

export interface CreateOAuthAuthorizationRequestInput {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: Date;
  id: string;
  organizationId?: string | null;
  redirectUri: string;
  requestHash: string;
  requestedScopes: readonly string[];
  resource: string;
  stateCiphertext: string;
  userId?: string | null;
}

export interface CreateOAuthAuthorizationCodeInput {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: Date;
  grantId: string;
  id: string;
  organizationId?: string | null;
  redirectUri: string;
  resource: string;
  scopes: readonly string[];
  userId: string;
}

export interface ConsumeOAuthAuthorizationCodeInput {
  clientId: string;
  codeChallenge: string;
  codeHash: string;
  redirectUri: string;
  resource: string;
}

export interface CreateOAuthRefreshTokenInput {
  clientId: string;
  expiresAt: Date;
  familyId: string;
  grantId: string;
  id: string;
  organizationId?: string | null;
  parentTokenId?: string | null;
  resource: string;
  scopes: readonly string[];
  tokenHash: string;
  userId: string;
}

export interface CompleteOAuthAuthorizationInput
  extends CreateOAuthAuthorizationCodeInput {
  codeHash: string;
  requestId: string;
  scopes: readonly string[];
}

export interface CompleteOAuthAuthorizationResult {
  code: OAuthAuthorizationCode;
  grant: OAuthAuthorizationGrant;
  request: OAuthAuthorizationRequest;
}

export interface RotateOAuthRefreshTokenInput {
  clientId: string;
  replacement: CreateOAuthRefreshTokenInput;
  resource: string;
  tokenHash: string;
}

export type OAuthRefreshRotationResult =
  | { kind: "missing" }
  | { kind: "replay"; familyId: string }
  | { kind: "rotated"; previous: OAuthRefreshToken; replacement: OAuthRefreshToken };

export interface OAuthClientStore {
  create(input: CreateOAuthClientInput): Promise<OAuthClient>;
  disable(clientId: string): Promise<void>;
  get(clientId: string): Promise<OAuthClient | null>;
  update(
    clientId: string,
    input: Partial<CreateOAuthClientInput>
  ): Promise<OAuthClient | null>;
}

export interface OAuthGrantStore {
  authorize(input: AuthorizeOAuthGrantInput): Promise<OAuthAuthorizationGrant>;
  findActive(input: OAuthGrantLookup): Promise<OAuthAuthorizationGrant | null>;
  get(id: string): Promise<OAuthAuthorizationGrant | null>;
  listForUser(userId: string): Promise<OAuthAuthorizationGrant[]>;
  revoke(input: { grantId: string; reason: string; revokedBy?: string }): Promise<void>;
  touch(id: string): Promise<void>;
}

export interface OAuthAuthorizationRequestStore {
  approve(
    id: string,
    input: { organizationId?: string | null; userId: string }
  ): Promise<OAuthAuthorizationRequest | null>;
  create(input: CreateOAuthAuthorizationRequestInput): Promise<OAuthAuthorizationRequest>;
  deny(id: string): Promise<void>;
  get(id: string): Promise<OAuthAuthorizationRequest | null>;
  consume(id: string): Promise<OAuthAuthorizationRequest | null>;
}

export interface OAuthAuthorizationCodeStore {
  consume(
    input: ConsumeOAuthAuthorizationCodeInput
  ): Promise<OAuthAuthorizationCode | null>;
  create(
    input: CreateOAuthAuthorizationCodeInput & { codeHash: string }
  ): Promise<OAuthAuthorizationCode>;
  getByHash(codeHash: string): Promise<OAuthAuthorizationCode | null>;
}

export interface OAuthRefreshTokenStore {
  create(input: CreateOAuthRefreshTokenInput): Promise<OAuthRefreshToken>;
  getByHash(tokenHash: string): Promise<OAuthRefreshToken | null>;
  listFamily(familyId: string): Promise<OAuthRefreshToken[]>;
  revokeFamily(familyId: string, reason: string): Promise<void>;
  rotate(input: RotateOAuthRefreshTokenInput): Promise<OAuthRefreshRotationResult>;
}

export interface OAuthAccessTokenRevocationStore {
  isRevoked(jti: string): Promise<boolean>;
  revoke(input: OAuthRevokedAccessToken): Promise<void>;
}

export interface OAuthAuthorizationServerStores {
  accessTokens: OAuthAccessTokenRevocationStore;
  authorizationCodes: OAuthAuthorizationCodeStore;
  authorizationRequests: OAuthAuthorizationRequestStore;
  clients: OAuthClientStore;
  completeAuthorization(
    input: CompleteOAuthAuthorizationInput
  ): Promise<CompleteOAuthAuthorizationResult>;
  grants: OAuthGrantStore;
  refreshTokens: OAuthRefreshTokenStore;
}
