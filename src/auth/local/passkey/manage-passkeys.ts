/**
 * Session-required passkey management:
 * GET /passkey/list-user-passkeys
 * POST /passkey/delete-passkey
 * POST /passkey/update-passkey
 */
import type { NormalizedAthenaAuthConfig } from "../../config.ts";
import type { AuthDomainMutate } from "../../hooks/execute.ts";
import { sanitizeHookPasskey } from "../../hooks/sanitize.ts";
import type { AthenaStoredPasskey } from "../../passkey/server/types.ts";
import { countRemainingAuthenticationMethods } from "../credential-viability.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "../models.ts";
import { readJsonBody } from "../security.ts";
import { createPasskeyRepository } from "./repository.ts";
import { toPasskeyView } from "./view.ts";

export interface ManagePasskeysContext {
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
  mutate: AuthDomainMutate;
  requireSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{ session: AuthSessionRow; token: string; user: AuthUserRow }>;
  stores: AthenaAuthStores;
  traceId: string;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw AthenaAuthRuntimeError.badRequest(`${field} is required`);
  }
  return value.trim();
}

function mapPasskeyNotFound(error: unknown): never {
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("passkey not found")
  ) {
    throw AthenaAuthRuntimeError.notFound("Passkey not found");
  }
  throw error;
}

async function loadOwnedPasskey(
  stores: AthenaAuthStores,
  userId: string,
  id: string
): Promise<AthenaStoredPasskey> {
  const rows = await createPasskeyRepository(stores).listByUser(userId);
  const row = rows.find((item) => item.id === id);
  if (!row) {
    throw AthenaAuthRuntimeError.notFound("Passkey not found");
  }
  return row;
}

function identifyingPasskey(row: AthenaStoredPasskey) {
  return sanitizeHookPasskey({
    createdAt: row.createdAt,
    id: row.id,
    name: row.name,
    userId: row.userId,
  });
}

export async function handleListUserPasskeysRoute(
  request: Request,
  path: string,
  method: string,
  ctx: ManagePasskeysContext
): Promise<Response | undefined> {
  if (path === "/passkey/list-user-passkeys" && method === "GET") {
    const { user } = await ctx.requireSession(request, ctx.stores);
    const rows = await createPasskeyRepository(ctx.stores).listByUser(user.id);
    return jsonResponse(
      200,
      rows.map((row) => toPasskeyView(row)),
      ctx.headers
    );
  }
}

export async function handleDeletePasskeyRoute(
  request: Request,
  path: string,
  method: string,
  ctx: ManagePasskeysContext
): Promise<Response | undefined> {
  if (path === "/passkey/delete-passkey" && method === "POST") {
    const { user } = await ctx.requireSession(request, ctx.stores);
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const id = requireNonEmptyString(body.id, "id");
    const existing = await loadOwnedPasskey(ctx.stores, user.id, id);
    const remaining = await countRemainingAuthenticationMethods(
      ctx.stores,
      user.id,
      { passkeyId: id }
    );
    if (remaining <= 0) {
      throw new AthenaAuthRuntimeError(
        409,
        "Cannot delete the last authentication method",
        { code: "ATHENA_AUTH_LAST_AUTHENTICATION_METHOD" }
      );
    }
    try {
      await ctx.mutate({
        context: {
          actor: { kind: "user", userId: user.id },
          request: ctx.hookRequest(request, path),
          traceId: ctx.traceId,
        },
        event: "passkey.delete",
        execute: async (scope) => {
          await createPasskeyRepository(scope.stores).delete({
            id,
            userId: user.id,
          });
        },
        input: { id },
        previous: async () => ({ passkey: identifyingPasskey(existing) }),
        resultOf: () => ({
          deleted: true as const,
          id,
          userId: user.id,
        }),
      });
    } catch (error) {
      mapPasskeyNotFound(error);
    }
    return jsonResponse(200, { status: true }, ctx.headers);
  }
}

export async function handleUpdatePasskeyRoute(
  request: Request,
  path: string,
  method: string,
  ctx: ManagePasskeysContext
): Promise<Response | undefined> {
  if (path === "/passkey/update-passkey" && method === "POST") {
    const { user } = await ctx.requireSession(request, ctx.stores);
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const id = requireNonEmptyString(body.id, "id");
    const name = requireNonEmptyString(body.name, "name");
    const existing = await loadOwnedPasskey(ctx.stores, user.id, id);
    try {
      const updated = await ctx.mutate({
        context: {
          actor: { kind: "user", userId: user.id },
          request: ctx.hookRequest(request, path),
          traceId: ctx.traceId,
        },
        event: "passkey.update",
        execute: (scope) =>
          createPasskeyRepository(scope.stores).updateName({
            id,
            name,
            userId: user.id,
          }),
        input: { id, name },
        previous: async () => ({ passkey: identifyingPasskey(existing) }),
        resultOf: (row) => ({ passkey: identifyingPasskey(row) }),
      });
      return jsonResponse(
        200,
        { passkey: toPasskeyView(updated) },
        ctx.headers
      );
    } catch (error) {
      mapPasskeyNotFound(error);
    }
  }
}
