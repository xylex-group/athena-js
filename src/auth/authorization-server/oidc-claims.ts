import type { AuthUserRow } from "../local/models.ts";
import type { OidcIdentityScope } from "./types.ts";

export interface AthenaOidcIdentityClaims {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  preferred_username?: string;
  sub: string;
}

export function projectOidcClaims(input: {
  identityScopes: readonly OidcIdentityScope[];
  user: AuthUserRow;
}): AthenaOidcIdentityClaims {
  const scopes = new Set(input.identityScopes);
  const preferredUsername =
    input.user.display_username ?? input.user.username;
  return {
    ...(scopes.has("email") && input.user.email != null
      ? {
          email: input.user.email,
          email_verified: input.user.email_verified,
        }
      : {}),
    ...(scopes.has("profile") && input.user.name != null
      ? { name: input.user.name }
      : {}),
    ...(scopes.has("profile") && input.user.image != null
      ? { picture: input.user.image }
      : {}),
    ...(scopes.has("profile") &&
    preferredUsername != null
      ? {
          preferred_username: preferredUsername,
        }
      : {}),
    sub: input.user.id,
  };
}
