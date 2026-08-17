import type { AthenaAuthStores } from "../local/memory-stores.ts";
import { AthenaAuthEmailError } from "./errors.ts";

export interface AthenaAuthEmailVariableBinding {
  name: string;
  required?: boolean;
  source: string;
}

export interface AthenaAuthEmailRenderAnchors {
  organizationId?: string;
  sessionToken?: string;
  userId?: string;
}

function parseSourceAddress(source: string): [string, string, string] {
  const parts = source.split(".").map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw AthenaAuthEmailError.badRequest(
      `variable binding source '${source}' must use schema.table.column format`
    );
  }
  return [parts[0] as string, parts[1] as string, parts[2] as string];
}

function columnValue(record: Record<string, unknown> | undefined, column: string): string | undefined {
  if (!record) {
    return undefined;
  }
  const value = record[column];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function resolveEmailBindings(
  stores: AthenaAuthStores,
  bindings: AthenaAuthEmailVariableBinding[],
  explicit: Record<string, string>,
  anchors: AthenaAuthEmailRenderAnchors
): Promise<Record<string, string>> {
  const variables = { ...explicit };
  let userId = anchors.userId;
  let organizationId = anchors.organizationId;

  if ((!userId || !organizationId) && anchors.sessionToken) {
    const session = await stores.getSessionByToken(anchors.sessionToken);
    if (session) {
      userId ??= session.user_id;
      organizationId ??= session.active_organization_id ?? undefined;
    }
  }

  for (const binding of bindings) {
    const [, table, column] = parseSourceAddress(binding.source);
    const normalizedTable = table.toLowerCase();

    if (normalizedTable === "sessions" || normalizedTable === "session") {
      if (column.toLowerCase() === "token") {
        throw AthenaAuthEmailError.badRequest(
          `variable binding '${binding.name}' may not expose session token values`
        );
      }
    }

    let resolved: string | undefined;
    if (normalizedTable === "users" || normalizedTable === "user") {
      if (!userId) {
        if (binding.required) {
          throw AthenaAuthEmailError.badRequest(
            `variable binding '${binding.name}' requires a user_id render anchor`
          );
        }
        continue;
      }
      const user = await stores.getUserById(userId);
      resolved = columnValue(user as unknown as Record<string, unknown>, column);
    } else if (normalizedTable === "organizations" || normalizedTable === "organization") {
      if (!organizationId) {
        if (binding.required) {
          throw AthenaAuthEmailError.badRequest(
            `variable binding '${binding.name}' requires an organization_id render anchor`
          );
        }
        continue;
      }
      const organization = await stores.getOrganization(organizationId);
      resolved = columnValue(
        organization as unknown as Record<string, unknown> | undefined,
        column
      );
    } else if (normalizedTable === "sessions" || normalizedTable === "session") {
      if (!anchors.sessionToken) {
        if (binding.required) {
          throw AthenaAuthEmailError.badRequest(
            `variable binding '${binding.name}' requires a session_token render anchor`
          );
        }
        continue;
      }
      const session = await stores.getSessionByToken(anchors.sessionToken);
      resolved = columnValue(
        session as unknown as Record<string, unknown> | undefined,
        column
      );
    } else {
      throw AthenaAuthEmailError.badRequest(
        `variable binding source '${binding.source}' is not supported by athena-auth email rendering`
      );
    }

    if (resolved === undefined) {
      if (binding.required) {
        throw AthenaAuthEmailError.badRequest(
          `required variable binding '${binding.name}' did not resolve a value`
        );
      }
      continue;
    }
    if (!(binding.name in variables)) {
      variables[binding.name] = resolved;
    }
  }

  return variables;
}
