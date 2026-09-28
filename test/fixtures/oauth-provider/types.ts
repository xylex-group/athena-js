export type OAuthFixtureScenario =
  | "ok"
  | "invalid-code"
  | "provider-error"
  | "issuer-mismatch"
  | "expired-token"
  | "wrong-nonce"
  | "refresh";

export interface OAuthIssuedCode {
  challenge?: string;
  challengeMethod?: string;
  clientId: string;
  code: string;
  nonce?: string;
  redirectUri: string;
  scenario: OAuthFixtureScenario;
  subject: string;
}

export interface OAuthIssuedToken {
  accessToken: string;
  clientId: string;
  expiresAt: number;
  idToken?: string;
  refreshToken?: string;
  scenario: OAuthFixtureScenario;
  subject: string;
}

export interface OAuthFixtureStore {
  codes: Map<string, OAuthIssuedCode>;
  refreshTokens: Map<string, OAuthIssuedToken>;
  tokens: Map<string, OAuthIssuedToken>;
}

export interface OAuthFixtureConfig {
  clientId: string;
  clientSecret: string;
  issuer: string;
  secondClientId?: string;
  secondClientSecret?: string;
}
