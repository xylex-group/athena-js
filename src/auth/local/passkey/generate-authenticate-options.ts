/**
 * Local POST /passkey/generate-authenticate-options.
 * Optional session: identified credentials vs discoverable (empty allowCredentials).
 */
import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
} from "@simplewebauthn/server";

import type { NormalizedAthenaAuthConfig } from "../../config.ts";
import type {
  AthenaPasskeyRelyingParty,
  AthenaStoredPasskey,
} from "../../passkey/server/types.ts";
import type { AthenaPasskeyOptionsResponse } from "../../types.ts";
import { base64Url } from "../../utils/base64.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "../models.ts";
import { createPasskeyChallengeStore } from "./challenge-store.ts";
import { createPasskeyRepository } from "./repository.ts";

const CHALLENGE_BYTES = 32;

export interface GenerateAuthenticateOptionsContext {
  config: NormalizedAthenaAuthConfig;
  headers: Headers;
  relyingParty: AthenaPasskeyRelyingParty | undefined;
  resolveSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  } | null>;
  stores: AthenaAuthStores;
}

async function readIdentifierBody(
  request: Request
): Promise<{ email?: string; userId?: string }> {
  try {
    const clone = request.clone();
    const text = await clone.text();
    if (!text.trim()) {
      return {};
    }
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const email =
      typeof record.email === "string" && record.email.trim()
        ? record.email.trim()
        : undefined;
    const userId =
      typeof record.userId === "string" && record.userId.trim()
        ? record.userId.trim()
        : undefined;
    return { email, userId };
  } catch {
    return {};
  }
}

async function resolveIdentifiedUserId(
  request: Request,
  stores: AthenaAuthStores
): Promise<string | null> {
  const body = await readIdentifierBody(request);
  if (body.userId) {
    const user = await stores.getUserById(body.userId);
    return user?.id ?? null;
  }
  if (body.email) {
    const user = await stores.getUserByEmail(body.email);
    return user?.id ?? null;
  }
  return null;
}

function allowCredentialsFromStored(
  rows: readonly AthenaStoredPasskey[]
): NonNullable<AthenaPasskeyOptionsResponse["allowCredentials"]> {
  return rows.map((row) => {
    const id = base64Url.encode(row.credentialId, { padding: false });
    if (row.transports.length === 0) {
      return { id, type: "public-key" };
    }
    return {
      id,
      transports: [...row.transports],
      type: "public-key",
    };
  });
}

function toLooseExtensions(
  value: unknown
): AthenaPasskeyOptionsResponse["extensions"] {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const record: NonNullable<AthenaPasskeyOptionsResponse["extensions"]> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

function toWireOptions(
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>,
  rp: AthenaPasskeyRelyingParty,
  allowCredentials: NonNullable<
    AthenaPasskeyOptionsResponse["allowCredentials"]
  >
): AthenaPasskeyOptionsResponse & { rpId: string } {
  return {
    allowCredentials,
    challenge: options.challenge,
    extensions: toLooseExtensions(options.extensions),
    rp: { id: rp.id, name: rp.name },
    rpId: rp.id,
    timeout: options.timeout,
    userVerification: options.userVerification,
  };
}

export async function handleGenerateAuthenticateOptionsRoute(
  request: Request,
  path: string,
  method: string,
  ctx: GenerateAuthenticateOptionsContext
): Promise<Response | undefined> {
  if (path === "/passkey/generate-authenticate-options" && method === "POST") {
    const rp = ctx.relyingParty;
    if (!rp) {
      throw new AthenaAuthRuntimeError(
        500,
        "Passkey relying party snapshot is not configured",
        { code: "ATHENA_RUNTIME_CONFIG_INVALID" }
      );
    }

    const resolved = await ctx.resolveSession(request, ctx.stores);
    const identifiedUserId = resolved
      ? resolved.user.id
      : await resolveIdentifiedUserId(request, ctx.stores);
    const existing = identifiedUserId
      ? await createPasskeyRepository(ctx.stores).listByUser(identifiedUserId)
      : [];
    const allowCredentials = allowCredentialsFromStored(existing);
    const rawChallenge = crypto.getRandomValues(
      new Uint8Array(CHALLENGE_BYTES)
    );
    const challengeHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", rawChallenge)
    );
    const ttlSeconds = ctx.config.passkey.challengeTtlSeconds;
    await createPasskeyChallengeStore(ctx.stores).create({
      challengeHash,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      purpose: "authentication",
      rpId: rp.id,
      userId: identifiedUserId,
    });

    const options = await generateAuthenticationOptions({
      allowCredentials: allowCredentials.flatMap((item) => {
        if (!item.id) {
          return [];
        }
        const descriptor: {
          id: string;
          transports?: AuthenticatorTransportFuture[];
        } = { id: item.id };
        if (item.transports && item.transports.length > 0) {
          descriptor.transports = [
            ...item.transports,
          ] as AuthenticatorTransportFuture[];
        }
        return [descriptor];
      }),
      challenge: rawChallenge,
      rpID: rp.id,
      timeout: ttlSeconds * 1000,
      userVerification:
        ctx.config.passkey.authentication.userVerification ?? "preferred",
    });

    return jsonResponse(
      200,
      toWireOptions(options, rp, allowCredentials),
      ctx.headers
    );
  }
}
