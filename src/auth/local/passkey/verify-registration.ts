/**
 * Local POST /passkey/verify-registration.
 * Wraps @simplewebauthn/server verifyRegistrationResponse (no CBOR/COSE by hand).
 * Do not import from src/browser.ts or passkey/browser.
 *
 * Do not load the server-only package here: this module is reached from
 * `v3-client.ts` → `src/index.ts`. That marker poisons Next Client Components
 * that resolve `@xylex-group/athena` to dist/index.js (webpack / OpenNext).
 */
import {
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type VerifiedRegistrationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  decodeAttestationObject,
  decodeClientDataJSON,
  isoBase64URL,
  parseAuthenticatorData,
} from "@simplewebauthn/server/helpers";

import type {
  AthenaPasskeyCeremonyContext,
  AthenaPasskeyOnboardingResolution,
  NormalizedAthenaAuthConfig,
} from "../../config.ts";
import { resolveAthenaPasskeyOnboardingUser } from "../../config.ts";
import type { AuthDomainMutate } from "../../hooks/execute.ts";
import {
  sanitizeHookPasskey,
  sanitizeHookSession,
  sanitizeHookUser,
} from "../../hooks/sanitize.ts";
import { normalizePasskeyAaguid } from "../../passkey/aaguid.ts";
import { mapPasskeyAuthenticatorMetadata } from "../../passkey/metadata.ts";
import {
  normalizeCredPropsResidentKey,
  requireUserVerificationFromPolicy,
} from "../../passkey/policy.ts";
import type {
  AthenaPasskeyRelyingParty,
  AthenaStoredPasskey,
} from "../../passkey/server/types.ts";
import { parseStoredPasskeyTransports } from "../../passkey/transports.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "../models.ts";
import { toPublicSession, toPublicUser } from "../models.ts";
import { readJsonBody } from "../security.ts";
import { createPasskeyChallengeStore } from "./challenge-store.ts";
import { createPasskeyRegistrationTransactionStore } from "./registration-transaction.ts";
import { createPasskeyRepository } from "./repository.ts";
import { toPasskeyView } from "./view.ts";

export interface VerifyRegistrationContext {
  config: NormalizedAthenaAuthConfig;
  headers: Headers;
  hookRequest: (
    request: Request,
    path: string
  ) => {
    ipAddress?: string;
    method: string;
    path: string;
    userAgent?: string;
  };
  issueSession: (
    request: Request,
    stores: AthenaAuthStores,
    userId: string
  ) => Promise<AuthSessionRow>;
  mutate: AuthDomainMutate;
  relyingParty: AthenaPasskeyRelyingParty | undefined;
  resolveOnboardingUser?: (
    context: AthenaPasskeyCeremonyContext
  ) =>
    | AthenaPasskeyOnboardingResolution
    | Promise<AthenaPasskeyOnboardingResolution>;
  resolveSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  } | null>;
  stores: AthenaAuthStores;
  traceId: string;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function parseJsonValue(value: unknown, label: string): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw AthenaAuthRuntimeError.badRequest(`Invalid ${label}`);
  }
}

/** Rust `normalize_webauthn_response_payload`: string JSON + unwrap nested `response` until `id`. */
function normalizeWebAuthnResponsePayload(
  raw: unknown
): Record<string, unknown> {
  let payload: unknown = parseJsonValue(raw, "passkey registration response");
  for (let index = 0; index < 3; index++) {
    const object = asRecord(payload);
    if (!object) {
      throw AthenaAuthRuntimeError.badRequest(
        "Invalid passkey registration response"
      );
    }
    if (typeof object.id === "string" && object.id.length > 0) {
      return object;
    }
    if (!("response" in object)) {
      throw AthenaAuthRuntimeError.badRequest(
        "Invalid passkey registration response"
      );
    }
    payload = parseJsonValue(object.response, "passkey registration response");
  }
  throw AthenaAuthRuntimeError.badRequest(
    "Invalid passkey registration response"
  );
}

function readClientTransports(
  credential: Record<string, unknown>
): string[] | undefined {
  const nested = asRecord(credential.response);
  const raw = Array.isArray(nested?.transports)
    ? nested.transports
    : Array.isArray(credential.transports)
      ? credential.transports
      : undefined;
  if (!raw) {
    return;
  }
  const listed = raw.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0
  );
  return listed.length > 0 ? listed : undefined;
}

function toRegistrationResponseJSON(
  credential: Record<string, unknown>
): RegistrationResponseJSON {
  const id = typeof credential.id === "string" ? credential.id : "";
  const rawId = typeof credential.rawId === "string" ? credential.rawId : id;
  const nested = asRecord(credential.response);
  const clientDataJSON =
    typeof nested?.clientDataJSON === "string" ? nested.clientDataJSON : "";
  const attestationObject =
    typeof nested?.attestationObject === "string"
      ? nested.attestationObject
      : "";
  if (!(id && clientDataJSON)) {
    throw AthenaAuthRuntimeError.badRequest(
      "Invalid passkey registration response"
    );
  }
  if (!attestationObject) {
    throw AthenaAuthRuntimeError.badRequest(
      "Invalid passkey registration response"
    );
  }
  const transports = readClientTransports(credential);
  return {
    clientExtensionResults: asRecord(credential.clientExtensionResults) ?? {},
    id,
    rawId,
    response: {
      attestationObject,
      clientDataJSON,
      ...(transports
        ? { transports: [...transports] as AuthenticatorTransportFuture[] }
        : {}),
    },
    type: "public-key",
  };
}

function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function challengeHashFromClientData(
  clientDataJSON: string
): Promise<{ challenge: string; challengeHash: Uint8Array }> {
  let challenge: string;
  try {
    const clientData = decodeClientDataJSON(clientDataJSON);
    if (typeof clientData.challenge !== "string" || !clientData.challenge) {
      throw new Error("missing challenge");
    }
    challenge = clientData.challenge;
  } catch {
    throw AthenaAuthRuntimeError.badRequest("Invalid clientDataJSON");
  }
  let challengeBytes: Uint8Array;
  try {
    challengeBytes = isoBase64URL.toBuffer(challenge);
  } catch {
    throw AthenaAuthRuntimeError.badRequest("Invalid clientDataJSON");
  }
  return {
    challenge,
    challengeHash: new Uint8Array(
      await crypto.subtle.digest("SHA-256", toArrayBufferBytes(challengeBytes))
    ),
  };
}

function flagsAndAaguidFromVerifiedAttestation(attestationObject: Uint8Array): {
  aaguid: string | null;
  flags: number;
} {
  const decoded = decodeAttestationObject(
    toArrayBufferBytes(attestationObject)
  );
  const parsed = parseAuthenticatorData(decoded.get("authData"));
  const aaguidSource =
    "aaguid" in parsed ? (parsed as { aaguid?: unknown }).aaguid : undefined;
  return {
    aaguid: normalizePasskeyAaguid(aaguidSource),
    flags: parsed.flags.flagsInt,
  };
}

function asStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultResolveOnboardingUser(
  context: AthenaPasskeyCeremonyContext
): AthenaPasskeyOnboardingResolution {
  try {
    return resolveAthenaPasskeyOnboardingUser(context);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Passkey onboarding failed";
    throw AthenaAuthRuntimeError.badRequest(message);
  }
}

function overlayName(body: Record<string, unknown>): string | null {
  return typeof body.name === "string" ? body.name : null;
}

function mapRegistrationTransactionError(error: unknown): never {
  if (error instanceof AthenaAuthRuntimeError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("already consumed")) {
    throw AthenaAuthRuntimeError.badRequest(
      "Passkey onboarding transaction was already completed"
    );
  }
  throw AthenaAuthRuntimeError.badRequest(
    "Passkey registration challenge is invalid or expired"
  );
}

export async function handleVerifyRegistrationRoute(
  request: Request,
  path: string,
  method: string,
  ctx: VerifyRegistrationContext
): Promise<Response | undefined> {
  if (path === "/passkey/verify-registration" && method === "POST") {
    const rp = ctx.relyingParty;
    if (!rp) {
      throw new AthenaAuthRuntimeError(
        500,
        "Passkey relying party snapshot is not configured",
        { code: "ATHENA_RUNTIME_CONFIG_INVALID" }
      );
    }

    const session = await ctx.resolveSession(request, ctx.stores);
    if (
      !session &&
      (request.headers.get("authorization") || request.headers.get("cookie"))
    ) {
      throw AthenaAuthRuntimeError.sessionNotFound();
    }
    const onboarding = !session && ctx.config.passkey.onboardingEnabled;
    if (!(session || onboarding)) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }

    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const credential = normalizeWebAuthnResponsePayload(body.response);
    const registrationResponse = toRegistrationResponseJSON(credential);
    const { challenge, challengeHash } = await challengeHashFromClientData(
      registrationResponse.response.clientDataJSON
    );

    const transactions = createPasskeyRegistrationTransactionStore(ctx.stores);
    if (session) {
      try {
        await createPasskeyChallengeStore(ctx.stores).consume({
          challengeHash,
          purpose: "registration",
          rpId: rp.id,
          userId: session.user.id,
        });
      } catch (error) {
        if (error instanceof AthenaAuthRuntimeError) {
          throw error;
        }
        throw AthenaAuthRuntimeError.badRequest(
          "Passkey registration challenge is invalid or expired"
        );
      }
    } else {
      try {
        await transactions.findActive({ challengeHash, rpId: rp.id });
      } catch (error) {
        mapRegistrationTransactionError(error);
      }
    }

    const requireUserVerification = requireUserVerificationFromPolicy(
      session
        ? ctx.config.passkey.registration.userVerification
        : ctx.config.passkey.registration.userVerification
    );
    let verified: VerifiedRegistrationResponse;
    try {
      verified = await verifyRegistrationResponse({
        expectedChallenge: challenge,
        expectedOrigin: [...rp.origins],
        expectedRPID: rp.id,
        requireUserVerification,
        response: registrationResponse,
      });
    } catch {
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey registration ceremony is invalid"
      );
    }
    if (verified.verified !== true || !verified.registrationInfo) {
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey registration ceremony is invalid"
      );
    }

    const info = verified.registrationInfo;
    let flags: number;
    let aaguid: string | null;
    try {
      const parsed = flagsAndAaguidFromVerifiedAttestation(
        info.attestationObject
      );
      flags = parsed.flags;
      aaguid =
        parsed.aaguid ??
        normalizePasskeyAaguid((info as { aaguid?: unknown }).aaguid);
    } catch {
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey registration ceremony is invalid"
      );
    }

    const mapped = mapPasskeyAuthenticatorMetadata({
      flags,
      transports: readClientTransports(credential),
    });
    const credentialId = isoBase64URL.toBuffer(info.credential.id);
    const residentKey = normalizeCredPropsResidentKey(
      registrationResponse.clientExtensionResults
    );
    const passkeyCreateBase = {
      aaguid,
      backedUp: mapped.backedUp,
      counter: BigInt(info.credential.counter),
      credentialId,
      deviceType: mapped.deviceType,
      name: overlayName(body),
      publicKey: new Uint8Array(info.credential.publicKey),
      residentKey,
      transports: (parseStoredPasskeyTransports(mapped.transports) ??
        []) as AthenaStoredPasskey["transports"],
    };

    if (session) {
      let stored: AthenaStoredPasskey;
      try {
        stored = await ctx.mutate({
          context: {
            actor: { kind: "user", userId: session.user.id },
            request: ctx.hookRequest(request, path),
            traceId: ctx.traceId,
          },
          event: "passkey.register",
          execute: (scope) =>
            createPasskeyRepository(scope.stores).create({
              ...passkeyCreateBase,
              userId: session.user.id,
            }),
          input: { userId: session.user.id },
          resultOf: (row) => ({
            passkey: sanitizeHookPasskey({
              id: row.id,
              name: row.name ?? overlayName(body),
              userId: row.userId,
            }),
          }),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw AthenaAuthRuntimeError.badRequest(
            "Passkey credential already registered"
          );
        }
        throw error;
      }
      return jsonResponse(
        200,
        toPasskeyView(stored, mapped.transports),
        ctx.headers
      );
    }

    const pending = await transactions.findActive({
      challengeHash,
      rpId: rp.id,
    });
    const mergedContext = {
      ...(asRecord(pending.context) ?? {}),
      ...(asStringField(body.email)
        ? { email: asStringField(body.email) }
        : {}),
      ...(asStringField(body.name) ? { name: asStringField(body.name) } : {}),
    };
    let resolution: AthenaPasskeyOnboardingResolution;
    try {
      resolution = ctx.resolveOnboardingUser
        ? await ctx.resolveOnboardingUser(mergedContext)
        : defaultResolveOnboardingUser(mergedContext);
    } catch (error) {
      if (error instanceof AthenaAuthRuntimeError) {
        throw error;
      }
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey onboarding user resolution failed"
      );
    }

    interface OnboardingResult {
      session?: AuthSessionRow;
      stored: AthenaStoredPasskey;
      user: AuthUserRow;
    }
    let completed: OnboardingResult;
    try {
      completed = await ctx.mutate({
        context: {
          actor: { kind: "user" },
          request: ctx.hookRequest(request, path),
          traceId: ctx.traceId,
        },
        event: "passkey.register",
        execute: async (scope) => {
          await createPasskeyRegistrationTransactionStore(scope.stores).consume(
            { challengeHash, rpId: rp.id }
          );
          let user: AuthUserRow | undefined;
          if ("existingUserId" in resolution) {
            user = await scope.stores.getUserById(resolution.existingUserId);
            if (!user) {
              throw AthenaAuthRuntimeError.badRequest(
                "Passkey onboarding user was not found"
              );
            }
          } else {
            if (await scope.stores.getUserByEmail(resolution.create.email)) {
              throw AthenaAuthRuntimeError.conflict(
                "A user with this email already exists"
              );
            }
            user = await scope.stores.createUser({
              email: resolution.create.email,
              id: crypto.randomUUID(),
              name:
                resolution.create.name ??
                resolution.create.email.split("@")[0] ??
                resolution.create.email,
            });
          }
          if (!user) {
            throw AthenaAuthRuntimeError.badRequest(
              "Passkey onboarding user was not found"
            );
          }
          const stored = await createPasskeyRepository(scope.stores).create({
            ...passkeyCreateBase,
            userId: user.id,
          });
          if (!ctx.config.passkey.onboardingCreateSession) {
            return { stored, user };
          }
          const issued = await ctx.issueSession(request, scope.stores, user.id);
          return { session: issued, stored, user };
        },
        input: {
          userId:
            "existingUserId" in resolution
              ? resolution.existingUserId
              : resolution.create.email,
        },
        resultOf: ({ stored }) => ({
          passkey: sanitizeHookPasskey({
            id: stored.id,
            name: stored.name ?? overlayName(body),
            userId: stored.userId,
          }),
        }),
        secondaryEvents: ({ session, user }) => {
          const extras = [];
          if ("create" in resolution) {
            extras.push({
              event: "user.create" as const,
              input: {
                email: user.email ?? resolution.create.email,
                name: user.name ?? resolution.create.name,
              },
              result: { user: sanitizeHookUser(user) },
            });
          }
          if (session) {
            extras.push({
              event: "session.issue" as const,
              input: { userId: session.user_id },
              result: { session: sanitizeHookSession(session) },
            });
          }
          return extras;
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AthenaAuthRuntimeError.badRequest(
          "Passkey credential already registered"
        );
      }
      if (error instanceof AthenaAuthRuntimeError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "";
      if (
        message.includes("already consumed") ||
        message.includes("expired") ||
        message.includes("not found")
      ) {
        mapRegistrationTransactionError(error);
      }
      throw error;
    }

    if (!completed.session) {
      return jsonResponse(
        200,
        {
          passkey: toPasskeyView(completed.stored, mapped.transports),
          session: null,
          token: null,
          user: toPublicUser(completed.user),
        },
        ctx.headers
      );
    }
    return jsonResponse(
      200,
      {
        passkey: toPasskeyView(completed.stored, mapped.transports),
        session: toPublicSession(completed.session),
        token: completed.session.token,
        user: toPublicUser(completed.user),
      },
      ctx.headers
    );
  }
}
