import {
  type CryptoKey,
  decodeProtectedHeader,
  importJWK,
  type JWTPayload,
  jwtVerify,
  SignJWT,
} from "jose";
import type { OAuthAccessTokenClaims } from "../authorization-server/types.ts";
import type { AthenaAuthProtocolIdentity } from "../protocol-identity.ts";
import type { AuthClock } from "./clock.ts";
import { systemAuthClock } from "./clock.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import {
  ensureActiveSigningKey,
  serializePublicJwks,
  type TokenKeyStore,
} from "./token-key-store.ts";

export interface AthenaTokenAuthorityOptions {
  clock?: AuthClock;
  identity: AthenaAuthProtocolIdentity;
  keyStore: TokenKeyStore;
}

export class AthenaTokenAuthority {
  private readonly clock: AuthClock;
  readonly identity: AthenaAuthProtocolIdentity;
  private readonly keyStore: TokenKeyStore;

  constructor(options: AthenaTokenAuthorityOptions) {
    this.clock = options.clock ?? systemAuthClock;
    this.identity = options.identity;
    this.keyStore = options.keyStore;
  }

  withKeyStore(keyStore: TokenKeyStore): AthenaTokenAuthority {
    return new AthenaTokenAuthority({
      clock: this.clock,
      identity: this.identity,
      keyStore,
    });
  }

  async signSessionToken(input: {
    audiences: string[];
    session: AuthSessionRow;
    ttl: number;
    user: AuthUserRow;
  }): Promise<{ kid: string; token: string }> {
    const signing = await ensureActiveSigningKey(this.keyStore);
    const now = this.clock.now();
    const token = await new SignJWT({
      sid: input.session.id,
    })
      .setProtectedHeader({ alg: "ES256", kid: signing.kid, typ: "JWT" })
      .setIssuer(this.identity.issuer)
      .setSubject(input.user.id)
      .setAudience(input.audiences)
      .setIssuedAt(now)
      .setNotBefore(0)
      .setExpirationTime(Math.floor(now.getTime() / 1000) + input.ttl)
      .setJti(crypto.randomUUID())
      .sign(signing.privateKey);
    return { kid: signing.kid, token };
  }

  async signOAuthAccessToken(claims: OAuthAccessTokenClaims): Promise<string> {
    if (claims.iss !== this.identity.issuer) {
      throw AthenaAuthRuntimeError.internal(
        new Error("OAuth access token issuer does not match protocol identity")
      );
    }
    const signing = await ensureActiveSigningKey(this.keyStore);
    return new SignJWT({
      athena_grant_id: claims.athena_grant_id,
      ...(claims.athena_organization_id
        ? { athena_organization_id: claims.athena_organization_id }
        : {}),
      ...(claims.athena_token_family_id
        ? { athena_token_family_id: claims.athena_token_family_id }
        : {}),
      client_id: claims.client_id,
      scope: claims.scope,
    })
      .setProtectedHeader({ alg: "ES256", kid: signing.kid, typ: "JWT" })
      .setIssuer(claims.iss)
      .setSubject(claims.sub)
      .setAudience(claims.aud)
      .setIssuedAt(claims.iat)
      .setNotBefore(claims.nbf)
      .setExpirationTime(claims.exp)
      .setJti(claims.jti)
      .sign(signing.privateKey);
  }

  async getJwks() {
    await ensureActiveSigningKey(this.keyStore);
    return serializePublicJwks(
      await this.keyStore.listVerificationKeys(this.clock.now())
    );
  }

  async verifyAthenaToken(input: {
    audience?: string;
    token: string;
  }): Promise<JWTPayload> {
    const header = decodeProtectedHeader(input.token);
    if (header.alg !== "ES256" || typeof header.kid !== "string") {
      throw new Error("Athena token algorithm or kid is invalid");
    }
    const keys = await this.keyStore.listVerificationKeys(this.clock.now());
    const key = keys.find((entry) => entry.kid === header.kid);
    if (!key) {
      throw new Error("Athena token signing key is unknown");
    }
    const cryptoKey = await importJWK(key.publicJwk, "ES256");
    const verified = await jwtVerify(input.token, cryptoKey, {
      algorithms: ["ES256"],
      currentDate: this.clock.now(),
      ...(input.audience ? { audience: input.audience } : {}),
      issuer: this.identity.issuer,
    });
    return verified.payload;
  }
}

export type { CryptoKey };
