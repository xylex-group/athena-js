import type { OAuthFixtureStore } from "./types.ts";

export function handleUserInfo(
  request: Request,
  store: OAuthFixtureStore
): Response {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const issued = store.tokens.get(token);
  if (!issued) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
  if (issued.expiresAt <= Date.now()) {
    return Response.json({ error: "invalid_token" }, { status: 401 });
  }
  return Response.json({
    email: `${issued.subject}@oauth.test`,
    email_verified: true,
    name: issued.subject,
    picture: null,
    sub: issued.subject,
  });
}
