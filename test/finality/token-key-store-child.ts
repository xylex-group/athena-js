/**
 * Cross-process JWT helper. Parent spawns this file with tsx.
 * Env: ATHENA_TOKEN_CHILD=mint|verify, DATABASE_URL, ATHENA_TOKEN_ISSUER,
 * ATHENA_TOKEN_SECRET, ATHENA_TOKEN_JWT (verify).
 */
import { createLocalJWKSet, jwtVerify, SignJWT } from "jose";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { PostgresTokenKeyStore } from "../../src/auth/local/postgres-token-key-store.ts";
import {
  ensureActiveSigningKey,
  serializePublicJwks,
} from "../../src/auth/local/token-key-store.ts";

const mode = process.env.ATHENA_TOKEN_CHILD ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
const issuer = process.env.ATHENA_TOKEN_ISSUER ?? "http://issuer.athena.test";
const secret =
  process.env.ATHENA_TOKEN_SECRET ?? "finality-jwt-secret-32-chars!!";

const database = await createPostgresAuthDatabase(databaseUrl);
const store = new PostgresTokenKeyStore({
  database,
  encryptionSecret: secret,
  issuer,
});

if (mode === "mint") {
  const signing = await ensureActiveSigningKey(store);
  const token = await new SignJWT({ sub: "child-user" })
    .setProtectedHeader({ alg: "ES256", kid: signing.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience("athena")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(signing.privateKey);
  process.stdout.write(`${JSON.stringify({ kid: signing.kid, token })}\n`);
} else if (mode === "verify") {
  const token = process.env.ATHENA_TOKEN_JWT ?? "";
  const jwks = serializePublicJwks(
    await store.listVerificationKeys(new Date())
  );
  const set = createLocalJWKSet(jwks);
  const verified = await jwtVerify(token, set, {
    audience: "athena",
    issuer,
  });
  process.stdout.write(
    `${JSON.stringify({ kid: verified.protectedHeader.kid, ok: true })}\n`
  );
} else {
  throw new Error(`unknown ATHENA_TOKEN_CHILD=${mode}`);
}

await database.close?.();
