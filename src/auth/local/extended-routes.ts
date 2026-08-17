import type { NormalizedAthenaAuthConfig } from "../config.ts";
import {
  createClearSessionCookieHeader,
  readBearerToken,
  shouldSetSecureCookie,
} from "./cookies.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import { toPublicUser } from "./models.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import type { AthenaAuthPasswordHasher } from "./password.ts";
import { extractPasswordHash } from "./password.ts";
import {
  asStringField,
  readJsonBody,
  requireStringField,
} from "./security.ts";
import {
  generateApiKey,
  isApiKeyExpired,
  sha256Base64Url,
  toPublicApiKey,
} from "./api-key.ts";
import type { AuthApiKeyRow } from "./stores.ts";
import {
  buildTotpUri,
  decodeBase32,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.ts";

export interface ExtendedRouteContext {
  config: NormalizedAthenaAuthConfig;
  email?: {
    send?: (message: {
      subject: string;
      to: string;
      type: string;
      url?: string;
    }) => Promise<void> | void;
  };
  hasher: AthenaAuthPasswordHasher;
  headers: Headers;
  issueSession: (
    request: Request,
    stores: AthenaAuthStores,
    userId: string,
    headers: Headers
  ) => Promise<AuthSessionRow>;
  requireSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{ session: AuthSessionRow; token: string; user: AuthUserRow }>;
  stores: AthenaAuthStores;
}

async function requirePassword(
  user: AuthUserRow,
  password: string,
  hasher: AthenaAuthPasswordHasher
): Promise<void> {
  const storedHash = extractPasswordHash(user.metadata);
  if (!storedHash || !(await hasher.verify(password, storedHash))) {
    throw AthenaAuthRuntimeError.invalidCredentials();
  }
}

function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(5)))
      .toString("hex")
      .slice(0, 8)
      .toUpperCase()
  );
}

async function hashBackupCodes(
  codes: string[],
  hasher: AthenaAuthPasswordHasher
): Promise<string> {
  const hashed = [];
  for (const code of codes) {
    hashed.push(await hasher.hash(code));
  }
  return JSON.stringify(hashed);
}

export async function handleExtendedRoute(
  request: Request,
  path: string,
  method: string,
  ctx: ExtendedRouteContext
): Promise<Response | undefined> {
  const { config, hasher, headers, stores } = ctx;

  if (path === "/send-verification-email" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const email = requireStringField(body, "email");
    const user = await stores.getUserByEmail(email);
    if (!user) {
      throw AthenaAuthRuntimeError.notFound("No user found with this email address");
    }
    if (user.email_verified) {
      throw AthenaAuthRuntimeError.badRequest("Email is already verified");
    }
    const token = `verify_${crypto.randomUUID()}`;
    await stores.createVerification({
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      id: crypto.randomUUID(),
      identifier: email,
      value: token,
    });
    const callbackURL = asStringField(body, "callbackURL");
    const url = callbackURL
      ? `${callbackURL}${callbackURL.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : token;
    await ctx.email?.send?.({
      subject: "Verify your email",
      to: email,
      type: "verify-email",
      url,
    });
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/verify-email" && method === "GET") {
    const token = new URL(request.url).searchParams.get("token")?.trim();
    if (!token) {
      throw AthenaAuthRuntimeError.badRequest("token is required");
    }
    const verification = await stores.consumeVerification(token);
    if (!verification) {
      throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
    }
    const user = await stores.getUserByEmail(verification.identifier);
    if (!user) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    const updated = await stores.updateUser(user.id, { emailVerified: true });
    return jsonResponse(
      200,
      { status: true, user: toPublicUser(updated) },
      headers
    );
  }

  if (path === "/change-email" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const newEmail = requireStringField(body, "newEmail");
    if (await stores.getUserByEmail(newEmail)) {
      throw AthenaAuthRuntimeError.conflict("A user with this email already exists");
    }
    const token = `change_${crypto.randomUUID()}`;
    await stores.createVerification({
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      id: crypto.randomUUID(),
      identifier: `change-email:${resolved.user.id}:${newEmail}`,
      value: token,
    });
    await ctx.email?.send?.({
      subject: "Confirm your new email",
      to: newEmail,
      type: "change-email",
      url: token,
    });
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/change-email/verify" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const token = requireStringField(body, "token");
    const verification = await stores.consumeVerification(token);
    if (!verification) {
      throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
    }
    const match = /^change-email:([^:]+):(.+)$/.exec(verification.identifier);
    if (!match) {
      throw AthenaAuthRuntimeError.badRequest("Invalid token");
    }
    const updated = await stores.updateUser(match[1] ?? "", {
      email: match[2],
      emailVerified: true,
    });
    return jsonResponse(200, { status: true, user: toPublicUser(updated) }, headers);
  }

  if (path === "/delete-user" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const password = asStringField(body, "password");
    if (password) {
      await requirePassword(resolved.user, password, hasher);
    }
    await stores.deleteUser(resolved.user.id);
    headers.append(
      "set-cookie",
      createClearSessionCookieHeader(
        config.session.cookieName,
        shouldSetSecureCookie(request, config.security.cookieSecure)
      )
    );
    return jsonResponse(
      200,
      { message: "User deleted", success: true },
      headers
    );
  }

  if (path === "/api-key/create" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const prefix = asStringField(body, "prefix");
    const generated = await generateApiKey(prefix);
    const expiresIn = asStringField(body, "expiresIn");
    const expiresAt = expiresIn
      ? new Date(Date.now() + Number.parseInt(expiresIn, 10) * 1000)
      : null;
    const remainingRaw = asStringField(body, "remaining");
    const created = nowIso();
    const row: AuthApiKeyRow = {
      created_at: created,
      enabled: true,
      expires_at: expiresAt,
      id: crypto.randomUUID(),
      key: generated.hash,
      last_request: null,
      metadata: asStringField(body, "metadata") ?? null,
      name: asStringField(body, "name") ?? null,
      permissions: asStringField(body, "permissions") ?? null,
      prefix: prefix ?? null,
      remaining: remainingRaw ? Number.parseInt(remainingRaw, 10) : null,
      start: generated.start,
      updated_at: created,
      user_id: asStringField(body, "userId") ?? resolved.user.id,
    };
    const stored = await stores.createApiKey(row);
    return jsonResponse(200, toPublicApiKey(stored, generated.fullKey), headers);
  }

  if (path === "/api-key/list" && method === "GET") {
    const resolved = await ctx.requireSession(request, stores);
    const keys = await stores.listApiKeys(resolved.user.id);
    return jsonResponse(
      200,
      {
        apiKeys: keys.map((key) => {
          const publicKey = toPublicApiKey(key);
          delete publicKey.key;
          return publicKey;
        }),
      },
      headers
    );
  }

  if (path === "/api-key/get" && (method === "GET" || method === "POST")) {
    const resolved = await ctx.requireSession(request, stores);
    const id =
      method === "GET"
        ? new URL(request.url).searchParams.get("id")
        : asStringField(
            await readJsonBody(request, config.security.bodyLimitBytes),
            "id"
          );
    if (!id) {
      throw AthenaAuthRuntimeError.badRequest("id is required");
    }
    const key = await stores.getApiKeyById(id);
    if (!key || key.user_id !== resolved.user.id) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    const publicKey = toPublicApiKey(key);
    delete publicKey.key;
    return jsonResponse(200, publicKey, headers);
  }

  if (path === "/api-key/delete" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const id = asStringField(body, "keyId") ?? requireStringField(body, "id");
    const key = await stores.getApiKeyById(id);
    if (!key || key.user_id !== resolved.user.id) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    await stores.deleteApiKey(id);
    return jsonResponse(200, { success: true }, headers);
  }

  if (path === "/api-key/verify" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const rawKey = requireStringField(body, "key");
    const hash = await sha256Base64Url(rawKey);
    const key = await stores.getApiKeyByHash(hash);
    if (!key || !key.enabled || isApiKeyExpired(key)) {
      return jsonResponse(
        200,
        {
          error: { code: "INVALID_API_KEY", message: "Invalid API key" },
          key: null,
          valid: false,
        },
        headers
      );
    }
    await stores.touchApiKey(key.id);
    const publicKey = toPublicApiKey(key);
    delete publicKey.key;
    return jsonResponse(200, { error: null, key: publicKey, valid: true }, headers);
  }

  if (path === "/api-key/delete-all-expired-api-keys" && method === "POST") {
    await ctx.requireSession(request, stores);
    const deleted = await stores.deleteExpiredApiKeys();
    return jsonResponse(200, { deleted }, headers);
  }

  if (path === "/api-key/update" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const id = asStringField(body, "keyId") ?? requireStringField(body, "id");
    const key = await stores.getApiKeyById(id);
    if (!key || key.user_id !== resolved.user.id) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    const enabledRaw = body.enabled;
    const updated = await stores.updateApiKey(id, {
      enabled: typeof enabledRaw === "boolean" ? enabledRaw : undefined,
      metadata: asStringField(body, "metadata"),
      name: asStringField(body, "name"),
      permissions: asStringField(body, "permissions"),
    });
    if (!updated) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    const publicKey = toPublicApiKey(updated);
    delete publicKey.key;
    return jsonResponse(200, publicKey, headers);
  }

  if (path === "/two-factor/enable" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(resolved.user, requireStringField(body, "password"), hasher);
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes();
    await stores.createTwoFactor({
      backupCodes: await hashBackupCodes(backupCodes, hasher),
      id: crypto.randomUUID(),
      secret: secret.encoded,
      userId: resolved.user.id,
    });
    await stores.updateUser(resolved.user.id, { twoFactorEnabled: true });
    return jsonResponse(
      200,
      {
        backupCodes,
        totpURI: buildTotpUri({
          account: resolved.user.email ?? resolved.user.id,
          issuer: asStringField(body, "issuer") ?? "AthenaAuth",
          secret: secret.encoded,
        }),
      },
      headers
    );
  }

  if (path === "/two-factor/get-totp-uri" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(resolved.user, requireStringField(body, "password"), hasher);
    const record = await stores.getTwoFactorByUserId(resolved.user.id);
    if (!record) {
      throw AthenaAuthRuntimeError.notFound("Two-factor authentication not enabled");
    }
    return jsonResponse(
      200,
      {
        totpURI: buildTotpUri({
          account: resolved.user.email ?? resolved.user.id,
          secret: record.secret,
        }),
      },
      headers
    );
  }

  if (path === "/two-factor/disable" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(resolved.user, requireStringField(body, "password"), hasher);
    await stores.deleteTwoFactor(resolved.user.id);
    await stores.updateUser(resolved.user.id, { twoFactorEnabled: false });
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/two-factor/generate-backup-codes" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(resolved.user, requireStringField(body, "password"), hasher);
    const record = await stores.getTwoFactorByUserId(resolved.user.id);
    if (!record) {
      throw AthenaAuthRuntimeError.notFound("Two-factor authentication not enabled");
    }
    const backupCodes = generateBackupCodes();
    await stores.updateTwoFactorBackupCodes(
      resolved.user.id,
      await hashBackupCodes(backupCodes, hasher)
    );
    return jsonResponse(200, { backupCodes, status: true }, headers);
  }

  if (path === "/two-factor/verify-totp" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const code = requireStringField(body, "code");
    const pendingToken =
      asStringField(body, "token") ??
      readBearerToken(request.headers.get("authorization"));
    let user: AuthUserRow | undefined;
    if (pendingToken?.startsWith("2fa_")) {
      const verification = await stores.consumeVerification(pendingToken);
      if (!verification) {
        throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
      }
      user = await stores.getUserById(
        verification.identifier.replace(/^2fa_pending:/, "")
      );
    } else {
      user = (await ctx.requireSession(request, stores)).user;
    }
    if (!user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    const record = await stores.getTwoFactorByUserId(user.id);
    if (!record) {
      throw AthenaAuthRuntimeError.notFound("Two-factor authentication not enabled");
    }
    if (!(await verifyTotpCode(decodeBase32(record.secret), code))) {
      throw AthenaAuthRuntimeError.badRequest("Invalid TOTP code");
    }
    const session = await ctx.issueSession(request, stores, user.id, headers);
    const refreshed = (await stores.getUserById(user.id)) ?? user;
    return jsonResponse(
      200,
      {
        status: true,
        token: session.token,
        user: toPublicUser(refreshed),
      },
      headers
    );
  }

  if (path === "/two-factor/send-otp" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const otp = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    await stores.createVerification({
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      id: crypto.randomUUID(),
      identifier: `2fa_otp:${resolved.user.id}`,
      value: otp,
    });
    if (resolved.user.email) {
      await ctx.email?.send?.({
        subject: "Your verification code",
        to: resolved.user.email,
        type: "two-factor-otp",
        url: otp,
      });
    }
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/two-factor/verify-otp" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const code = requireStringField(body, "code");
    const verification = await stores.getVerificationByValue(code);
    if (
      !verification ||
      verification.identifier !== `2fa_otp:${resolved.user.id}`
    ) {
      throw AthenaAuthRuntimeError.badRequest("Invalid OTP code");
    }
    await stores.consumeVerification(code);
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/two-factor/verify-backup-code" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const code = requireStringField(body, "code").toUpperCase();
    const pendingToken =
      asStringField(body, "token") ??
      readBearerToken(request.headers.get("authorization"));
    let user: AuthUserRow | undefined;
    if (pendingToken?.startsWith("2fa_")) {
      const verification = await stores.consumeVerification(pendingToken);
      user = verification
        ? await stores.getUserById(
            verification.identifier.replace(/^2fa_pending:/, "")
          )
        : undefined;
    } else {
      user = (await ctx.requireSession(request, stores)).user;
    }
    if (!user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    const record = await stores.getTwoFactorByUserId(user.id);
    if (!record?.backup_codes) {
      throw AthenaAuthRuntimeError.badRequest("Invalid backup code");
    }
    const hashed = JSON.parse(record.backup_codes) as string[];
    let matchedIndex = -1;
    for (const [index, hash] of hashed.entries()) {
      if (await hasher.verify(code, hash)) {
        matchedIndex = index;
        break;
      }
    }
    if (matchedIndex < 0) {
      throw AthenaAuthRuntimeError.badRequest("Invalid backup code");
    }
    hashed.splice(matchedIndex, 1);
    await stores.updateTwoFactorBackupCodes(user.id, JSON.stringify(hashed));
    const session = await ctx.issueSession(request, stores, user.id, headers);
    return jsonResponse(
      200,
      {
        session: {
          token: session.token,
          userId: user.id,
        },
        user: toPublicUser(user),
      },
      headers
    );
  }

  return undefined;
}

export async function resolveApiKeyUser(
  request: Request,
  stores: AthenaAuthStores
): Promise<AuthUserRow | undefined> {
  const rawKey = request.headers.get("x-api-key")?.trim();
  if (!rawKey) {
    return undefined;
  }
  const hash = await sha256Base64Url(rawKey);
  const key = await stores.getApiKeyByHash(hash);
  if (!key || !key.enabled || isApiKeyExpired(key)) {
    return undefined;
  }
  await stores.touchApiKey(key.id);
  return stores.getUserById(key.user_id);
}

function nowIso(): string {
  return new Date().toISOString();
}

