import type {
  OAuthFixtureConfig,
  OAuthFixtureScenario,
  OAuthFixtureStore,
} from "./types.ts";

function scenarioFromRequest(url: URL): OAuthFixtureScenario {
  const raw = url.searchParams.get("scenario") ?? "ok";
  if (
    raw === "invalid-code" ||
    raw === "provider-error" ||
    raw === "issuer-mismatch" ||
    raw === "expired-token" ||
    raw === "wrong-nonce" ||
    raw === "refresh"
  ) {
    return raw;
  }
  return "ok";
}

export function handleAuthorization(
  url: URL,
  store: OAuthFixtureStore,
  config: OAuthFixtureConfig
): Response {
  const scenario = scenarioFromRequest(url);
  if (scenario === "provider-error") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!redirectUri) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const dest = new URL(redirectUri);
    dest.searchParams.set("error", "access_denied");
    dest.searchParams.set("state", state);
    return new Response(null, {
      headers: { Location: dest.toString() },
      status: 302,
    });
  }
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const nonce = url.searchParams.get("nonce") ?? undefined;
  const challenge = url.searchParams.get("code_challenge") ?? undefined;
  const challengeMethod =
    url.searchParams.get("code_challenge_method") ?? undefined;
  if (clientId !== config.clientId && clientId !== config.secondClientId) {
    return Response.json({ error: "unauthorized_client" }, { status: 400 });
  }
  if (!(redirectUri && state)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  if (challengeMethod && challengeMethod !== "S256") {
    return Response.json(
      { error: "invalid_request", error_description: "PKCE S256 required" },
      { status: 400 }
    );
  }
  const code = `code_${crypto.randomUUID()}`;
  store.codes.set(code, {
    challenge,
    challengeMethod,
    clientId,
    code,
    nonce,
    redirectUri,
    scenario,
    subject:
      clientId === config.secondClientId ? "fixture-user-b" : "fixture-user-a",
  });
  const dest = new URL(redirectUri);
  dest.searchParams.set("code", scenario === "invalid-code" ? "invalid" : code);
  dest.searchParams.set("state", state);
  return new Response(null, {
    headers: { Location: dest.toString() },
    status: 302,
  });
}
