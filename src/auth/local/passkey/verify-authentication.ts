/**
 * Local POST /passkey/verify-authentication.
 * Public. Consumes hash-only authentication challenge after credential lookup.
 */
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

import type { NormalizedAthenaAuthConfig } from "../../config.ts";
import type { AuthDomainMutate } from "../../hooks/execute.ts";
import { sanitizeHookSession } from "../../hooks/sanitize.ts";
import { requireUserVerificationFromPolicy } from "../../passkey/policy.ts";
import type { AthenaPasskeyRelyingParty } from "../../passkey/server/types.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import {
  type AuthSessionRow,
  toPublicSession,
  toPublicUser,
} from "../models.ts";
import { readJsonBody } from "../security.ts";
import { createPasskeyChallengeStore } from "./challenge-store.ts";
import { createPasskeyRepository } from "./repository.ts";
import {
  asPasskeyRecord,
  challengeHashFromClientData,
  normalizeWebAuthnResponsePayload,
} from "./wire.ts";

export interface VerifyAuthenticationContext {
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
  stores: AthenaAuthStores;
  traceId: string;
}

function toAuthenticationResponseJSON(
  credential: Record<string, unknown>
): AuthenticationResponseJSON {
  const id = typeof credential.id === "string" ? credential.id : "";
  const rawId = typeof credential.rawId === "string" ? credential.rawId : id;
  const nested = asPasskeyRecord(credential.response);
  const clientDataJSON =
    typeof nested?.clientDataJSON === "string" ? nested.clientDataJSON : "";
  const authenticatorData =
    typeof nested?.authenticatorData === "string"
      ? nested.authenticatorData
      : "";
  const signature =
    typeof nested?.signature === "string" ? nested.signature : "";
  const userHandle =
    typeof nested?.userHandle === "string" ? nested.userHandle : undefined;
  if (!(id && clientDataJSON && authenticatorData && signature)) {
    throw AthenaAuthRuntimeError.badRequest(
      "Invalid passkey authentication response"
    );
  }
  return {
    clientExtensionResults:
      asPasskeyRecord(credential.clientExtensionResults) ?? {},
    id,
    rawId,
    response: {
      authenticatorData,
      clientDataJSON,
      signature,
      ...(userHandle ? { userHandle } : {}),
    },
    type: "public-key",
  };
}

async function consumeAuthenticationChallenge(input: {
  challengeHash: Uint8Array;
  rpId: string;
  stores: AthenaAuthStores;
  userId: string;
}): Promise<void> {
  const store = createPasskeyChallengeStore(input.stores);
  try {
    await store.consume({
      challengeHash: input.challengeHash,
      purpose: "authentication",
      rpId: input.rpId,
      userId: input.userId,
    });
    return;
  } catch (error) {
    if (error instanceof AthenaAuthRuntimeError) {
      throw error;
    }
  }
  try {
    await store.consume({
      challengeHash: input.challengeHash,
      purpose: "authentication",
      rpId: input.rpId,
      userId: null,
    });
  } catch {
    throw AthenaAuthRuntimeError.badRequest(
      "Passkey authentication challenge is invalid or expired"
    );
  }
}

export async function handleVerifyAuthenticationRoute(
  request: Request,
  path: string,
  method: string,
  ctx: VerifyAuthenticationContext
): Promise<Response | undefined> {
  if (path === "/passkey/verify-authentication" && method === "POST") {
    const rp = ctx.relyingParty;
    if (!rp) {
      throw new AthenaAuthRuntimeError(
        500,
        "Passkey relying party snapshot is not configured",
        { code: "ATHENA_RUNTIME_CONFIG_INVALID" }
      );
    }

    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const credential = normalizeWebAuthnResponsePayload(
      asPasskeyRecord(body)?.response ?? body,
      "passkey authentication response"
    );
    const authenticationResponse = toAuthenticationResponseJSON(credential);
    const { challenge, challengeHash } = await challengeHashFromClientData(
      authenticationResponse.response.clientDataJSON
    );

    let credentialId: Uint8Array;
    try {
      credentialId = isoBase64URL.toBuffer(authenticationResponse.id);
    } catch {
      throw AthenaAuthRuntimeError.badRequest(
        "Invalid passkey authentication response"
      );
    }

    const repository = createPasskeyRepository(ctx.stores);
    const stored = await repository.findByCredentialId(credentialId);
    if (!stored) {
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey not found for credential"
      );
    }

    const user = await ctx.stores.getUserById(stored.userId);
    if (!user) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }

    let newCounter: number;
    try {
      const verified = await verifyAuthenticationResponse({
        credential: {
          counter: Number(stored.counter),
          id: authenticationResponse.id,
          publicKey: new Uint8Array(stored.publicKey),
          transports: stored.transports as AuthenticatorTransportFuture[],
        },
        expectedChallenge: challenge,
        expectedOrigin: [...rp.origins],
        expectedRPID: rp.id,
        requireUserVerification: requireUserVerificationFromPolicy(
          ctx.config.passkey.authentication.userVerification
        ),
        response: authenticationResponse,
      });
      if (verified.verified !== true) {
        throw new Error("unverified");
      }
      newCounter = verified.authenticationInfo.newCounter;
    } catch (error) {
      if (error instanceof AthenaAuthRuntimeError) {
        throw error;
      }
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey authentication ceremony is invalid"
      );
    }

    const received = BigInt(newCounter);
    if (
      !(stored.counter === 0n && received === 0n) &&
      received <= stored.counter
    ) {
      throw AthenaAuthRuntimeError.badRequest(
        "Passkey signature counter regression"
      );
    }

    const session = await ctx.mutate({
      context: {
        actor: { kind: "user", userId: stored.userId },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "session.issue",
      execute: async (scope) => {
        await consumeAuthenticationChallenge({
          challengeHash,
          rpId: rp.id,
          stores: scope.stores,
          userId: stored.userId,
        });
        if (!(stored.counter === 0n && received === 0n)) {
          try {
            await createPasskeyRepository(scope.stores).updateCounter({
              credentialId: stored.credentialId,
              expected: stored.counter,
              next: received,
            });
          } catch (error) {
            if (error instanceof AthenaAuthRuntimeError) {
              throw error;
            }
            throw AthenaAuthRuntimeError.badRequest(
              "Passkey signature counter regression"
            );
          }
        }
        return ctx.issueSession(request, scope.stores, stored.userId);
      },
      input: { userId: stored.userId },
      resultOf: (issued) => ({ session: sanitizeHookSession(issued) }),
    });

    const refreshed = (await ctx.stores.getUserById(stored.userId)) ?? user;
    return jsonResponse(
      200,
      {
        session: toPublicSession(session),
        token: session.token,
        user: toPublicUser(refreshed),
      },
      ctx.headers
    );
  }
}
