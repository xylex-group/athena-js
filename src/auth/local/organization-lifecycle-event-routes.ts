import { ORGANIZATION_AUTH_EVENTS_READ } from "../../rights/definitions.ts";
import type { AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import { organizationLifecycleEventFromAuditRow } from "../observability/organization-lifecycle.ts";
import { apiKeyScopeKind, bindApiKeyAuthorization } from "./api-key.ts";
import { verifiedOrganizationScope } from "./authorization-guard.ts";
import { buildSnapshot } from "./authorization-routes.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import type { AuthApiKeyRow } from "./stores.ts";

type ResolvedApiKey = {
  key: AuthApiKeyRow;
  permissions?: AthenaRightKey[];
  user: AuthUserRow;
};

type AuditPageInput = {
  after?: { createdAt: string; eventId: string };
  limit: number;
  organizationId: string;
};

function pageInput(request: Request): Omit<AuditPageInput, "organizationId"> {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw AthenaAuthRuntimeError.badRequest("limit must be between 1 and 100");
  }
  const cursor = params.get("cursor");
  if (cursor === null) {
    return { limit };
  }
  const splitAt = cursor.lastIndexOf("~");
  const createdAt = cursor.slice(0, splitAt);
  const eventId = cursor.slice(splitAt + 1);
  if (
    splitAt < 0 ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId
    )
  ) {
    throw AthenaAuthRuntimeError.badRequest("cursor is invalid");
  }
  return { after: { createdAt, eventId }, limit };
}

export async function handleOrganizationLifecycleEventRoute(
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
  ) => Promise<ResolvedApiKey | undefined>,
  readPage: (input: AuditPageInput) => Promise<{
    hasMore: boolean;
    rows: Record<string, unknown>[];
  }>
): Promise<Response | undefined> {
  if (!(path === "/organization/list-lifecycle-events" && method === "GET")) {
    return;
  }
  const apiKey = await resolveApiKey(request, stores);
  const session = apiKey ? undefined : await requireSession(request, stores);
  const user = apiKey?.user ?? session?.user;
  if (!user || (apiKey && apiKeyScopeKind(apiKey.key) !== "organization")) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const organizationId = verifiedOrganizationScope({
    activeOrganizationId:
      apiKey?.key.organization_id ?? session?.session.active_organization_id,
    requestedOrganizationId: new URL(request.url).searchParams.get(
      "organizationId"
    ),
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
    missingRequiredRights(effectiveRights, [ORGANIZATION_AUTH_EVENTS_READ])
      .length > 0
  ) {
    throw AthenaAuthRuntimeError.forbidden();
  }
  const page = await readPage({
    ...pageInput(request),
    organizationId,
  });
  const events = page.rows.flatMap((row) =>
    organizationLifecycleEventFromAuditRow(row, organizationId)
  );
  const last = page.rows.at(-1);
  return jsonResponse(
    200,
    {
      events,
      nextCursor:
        page.hasMore && last
          ? `${String(last.created_at)}~${String(last.event_id)}`
          : null,
    },
    headers
  );
}
