import { ORGANIZATION_AUTHENTICATION_READ } from "../../rights/definitions.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import { apiKeyScopeKind, bindApiKeyAuthorization } from "./api-key.ts";
import { verifiedOrganizationScope } from "./authorization-guard.ts";
import { buildSnapshot } from "./authorization-routes.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import type { ResolvedApiKeyPrincipal } from "./extended-routes.ts";

function pageValue(
  query: URLSearchParams,
  name: "limit" | "offset",
  fallback: number,
  maximum?: number
): number {
  const value = query.get(name);
  if (value === null) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw AthenaAuthRuntimeError.badRequest(`Invalid ${name}`);
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < (name === "limit" ? 1 : 0) ||
    (maximum !== undefined && parsed > maximum)
  ) {
    throw AthenaAuthRuntimeError.badRequest(`Invalid ${name}`);
  }
  return parsed;
}

export async function handleOrganizationAuthenticationPostureRoute(
  request: Request,
  path: string,
  method: string,
  stores: AthenaAuthStores,
  headers: Headers,
  requireSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{ session: AuthSessionRow; user: AuthUserRow }>,
  resolveApiKey: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<ResolvedApiKeyPrincipal | undefined>
): Promise<Response | undefined> {
  if (!(path === "/organization/list-authentication-posture" && method === "GET")) {
    return;
  }

  const apiKey = await resolveApiKey(request, stores);
  const session = apiKey ? undefined : await requireSession(request, stores);
  const user = apiKey?.user ?? session?.user;
  if (!user) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  if (apiKey && apiKeyScopeKind(apiKey.key) !== "organization") {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const query = new URL(request.url).searchParams;
  const organizationId = verifiedOrganizationScope({
    activeOrganizationId:
      apiKey?.key.organization_id ?? session?.session.active_organization_id,
    requestedOrganizationId: query.get("organizationId"),
  });
  if (!(await stores.getMember(organizationId, user.id))) {
    throw AthenaAuthRuntimeError.forbidden();
  }

  const ownerAuthorization = await buildSnapshot(stores, {
    session: { active_organization_id: organizationId },
    user,
  });
  const effectiveRights = apiKey
    ? bindApiKeyAuthorization(
        ownerAuthorization,
        apiKey.permissions,
        "organization"
      ).effectiveRights
    : ownerAuthorization.effectiveRights;
  if (
    missingRequiredRights(effectiveRights, [ORGANIZATION_AUTHENTICATION_READ])
      .length > 0
  ) {
    throw AthenaAuthRuntimeError.forbidden();
  }

  const limit = pageValue(query, "limit", 50, 100);
  const offset = pageValue(query, "offset", 0);
  const page = await stores.listAuthenticationPosture({
    limit,
    offset,
    organizationId,
  });
  const members = page.members.map((member) => ({
    phishResistant: member.hasPasskey,
    registeredMethods: [
      ...(member.hasPassword ? ["password"] : []),
      ...(member.hasSocial ? ["social"] : []),
      ...(member.hasPasskey ? ["passkey"] : []),
      ...(member.twoFactorEnabled ? ["totp"] : []),
    ].sort(),
    twoFactorEnabled: member.twoFactorEnabled,
    userId: member.userId,
  }));
  return jsonResponse(200, { limit, members, offset, total: page.total }, headers);
}
