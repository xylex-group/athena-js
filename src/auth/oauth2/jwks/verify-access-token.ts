import type { JWTPayload, JWTVerifyOptions } from "jose";
import { errors as joseErrors, UnsecuredJWT } from "jose";
import { logger } from "../../env/index.ts";
import { APIError } from "../../error.ts";
import { fetchRefusingRedirects } from "../reject-redirects.ts";
import type { VerifyAccessTokenRemote } from "./types.ts";
import { verifyJwsAccessToken } from "./verify-jws.ts";

const joseInfrastructureErrorCodes = new Set([
  joseErrors.JWKSTimeout.code,
  joseErrors.JWKSInvalid.code,
  joseErrors.JWKSMultipleMatchingKeys.code,
]);

function isJoseInfrastructureError(error: joseErrors.JOSEError): boolean {
  return joseInfrastructureErrorCodes.has(error.code);
}

/**
 * Performs local verification of an access token for your API.
 * Can also be configured for remote verification.
 */
export async function verifyAccessToken(
  token: string,
  opts: {
    verifyOptions: JWTVerifyOptions &
      Required<Pick<JWTVerifyOptions, "audience" | "issuer">>;
    /** Scopes to additionally verify. Token must include all but not exact. */
    scopes?: string[];
    /** Required to verify access token locally */
    jwksUrl?: string;
    /** If provided, can verify a token remotely */
    remoteVerify?: VerifyAccessTokenRemote;
  }
) {
  let payload: JWTPayload | undefined;

  if (opts.jwksUrl && !opts?.remoteVerify?.force) {
    try {
      payload = await verifyJwsAccessToken(token, {
        jwksFetch: opts.jwksUrl,
        verifyOptions: opts.verifyOptions,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "TypeError" || error.name === "JWSInvalid") {
          // likely an opaque token (continue)
        } else if (error instanceof joseErrors.JWTExpired) {
          // APIError forwards options.cause to Error; biome only matches `new Error`.
          // biome-ignore lint/style/useErrorCause: custom APIError carries cause
          throw new APIError(
            "UNAUTHORIZED",
            {
              message: "token expired",
            },
            { cause: error }
          );
        } else if (error instanceof joseErrors.JOSEError) {
          if (isJoseInfrastructureError(error)) {
            throw error;
          }
          // biome-ignore lint/style/useErrorCause: custom APIError carries cause
          throw new APIError(
            "UNAUTHORIZED",
            {
              message: "invalid access token",
            },
            { cause: error }
          );
        } else {
          throw error;
        }
      } else {
        throw new Error(String(error), { cause: error });
      }
    }
  }

  if (opts?.remoteVerify) {
    const { data: introspect, error: introspectError } =
      await fetchRefusingRedirects<
        JWTPayload & {
          active: boolean;
        }
      >(opts.remoteVerify.introspectUrl, {
        body: new URLSearchParams({
          client_id: opts.remoteVerify.clientId,
          client_secret: opts.remoteVerify.clientSecret,
          token,
          token_type_hint: "access_token",
        }).toString(),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      });
    if (introspectError) {
      logger.error(
        `Introspection failed: ${introspectError.message ?? introspectError.statusText}`
      );
    }
    if (!introspect) {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "introspection failed",
      });
    }
    if (!introspect.active) {
      throw new APIError("UNAUTHORIZED", {
        message: "token inactive",
      });
    }
    try {
      const unsecuredJwt = new UnsecuredJWT(introspect).encode();
      const skipAudience =
        !introspect.aud && opts.remoteVerify.allowMissingAudience === true;
      const verifyOptionsNoAudience = { ...opts.verifyOptions };
      (verifyOptionsNoAudience as { audience?: unknown }).audience = undefined;
      const verify = UnsecuredJWT.decode(
        unsecuredJwt,
        skipAudience ? verifyOptionsNoAudience : opts.verifyOptions
      );
      payload = verify.payload;
    } catch (error) {
      throw new Error(String(error), { cause: error });
    }
  }

  if (!payload) {
    throw new APIError("UNAUTHORIZED", {
      message: "no token payload",
    });
  }

  if (opts.scopes) {
    const validScopes = new Set(
      (payload.scope as string | undefined)?.split(" ")
    );
    for (const sc of opts.scopes) {
      if (!validScopes.has(sc)) {
        throw new APIError("FORBIDDEN", {
          message: `invalid scope ${sc}`,
        });
      }
    }
  }

  return payload;
}
