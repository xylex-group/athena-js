/**
 * Local GET /.well-known/webauthn.
 * Origins come from the RP snapshot only — never request Host.
 */
import type { AthenaPasskeyRelyingParty } from "../../passkey/server/types.ts";
import { jsonResponse } from "../errors.ts";

export async function handleRelatedOriginsRoute(
  _request: Request,
  path: string,
  method: string,
  ctx: {
    headers: Headers;
    relyingParty: AthenaPasskeyRelyingParty | undefined;
  }
): Promise<Response | undefined> {
  if (path === "/.well-known/webauthn" && method === "GET") {
    return jsonResponse(
      200,
      { origins: [...(ctx.relyingParty?.relatedOrigins ?? [])] },
      ctx.headers
    );
  }
}
