import { type AthenaRightKey, parseAthenaRightKey } from "../../rights/key.ts";
import type { AthenaPrincipalRightsProjection } from "./principal.ts";

/**
 * Legacy `rightsByRole` / `mode: "role"` projection. Persisted authorization
 * assignments are the product SSOT. Do not add new consumers of this path.
 */

export type AthenaRightsResolutionMode = "role" | "stored";

export type AthenaRightsResolutionSource =
  | "role"
  | "default-role"
  | "stored"
  | "none";

export type AthenaRightsResolutionReason =
  | "role_not_mapped"
  | "default_role_not_mapped"
  | "no_rights_configured";

export type AthenaRightsResolution =
  | {
      ok: true;
      role: string;
      source: Exclude<AthenaRightsResolutionSource, "none">;
      rights: readonly string[];
    }
  | {
      ok: false;
      reason: AthenaRightsResolutionReason;
      role: string;
      rights: readonly [];
      source: "none";
    };

export const ATHENA_RIGHTS_RESOLUTION_KIND =
  "athena_rights_resolution" as const;

export interface AthenaRightsResolutionDiagnostic {
  configuredRoles: readonly string[];
  defaultRole?: string;
  effectiveRightCount: number;
  effectiveRights: readonly string[];
  kind: typeof ATHENA_RIGHTS_RESOLUTION_KIND;
  mode: AthenaRightsResolutionMode;
  reason?: AthenaRightsResolutionReason;
  selectedRole?: string;
  source: AthenaRightsResolutionSource;
  storedRole?: string;
  userId: string;
}

export type AthenaRightsResolutionDiagnosticListener = (
  diagnostic: AthenaRightsResolutionDiagnostic
) => void;

export interface AthenaRightsProjectionValidationIssue {
  message: string;
  path: string;
}

export interface AthenaRightsProjectionValidation {
  issues: readonly AthenaRightsProjectionValidationIssue[];
  ok: boolean;
}

export const ATHENA_PERSISTED_AUTHORIZATION_RESOLUTION_KIND =
  "athena_persisted_authorization_resolution" as const;

export interface AthenaPersistedAuthorizationDiagnostic {
  assignment: "present" | "absent" | "unknown";
  error?: string;
  fallback: "forbidden" | "legacy-role-map";
  kind: typeof ATHENA_PERSISTED_AUTHORIZATION_RESOLUTION_KIND;
  resolution: "ok" | "failed";
  source: "persisted";
  userId: string;
}

const listeners = new Set<AthenaRightsResolutionDiagnosticListener>();
let lastDiagnostic: AthenaRightsResolutionDiagnostic | undefined;
let lastPersistedDiagnostic: AthenaPersistedAuthorizationDiagnostic | undefined;

export function subscribeAthenaRightsResolutionDiagnostics(
  listener: AthenaRightsResolutionDiagnosticListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLastAthenaRightsResolutionDiagnostic():
  | AthenaRightsResolutionDiagnostic
  | undefined {
  return lastDiagnostic;
}

export function getLastAthenaPersistedAuthorizationDiagnostic():
  | AthenaPersistedAuthorizationDiagnostic
  | undefined {
  return lastPersistedDiagnostic;
}

export function formatAthenaPersistedAuthorizationDiagnostic(
  diagnostic: AthenaPersistedAuthorizationDiagnostic
): string {
  const lines = [
    "Auth authorization",
    "Source .............. persisted",
    `User assignment ..... ${diagnostic.assignment}`,
    `Resolution .......... ${diagnostic.resolution}`,
    `Fallback ............ ${diagnostic.fallback}`,
  ];
  if (diagnostic.error) {
    lines.push(`Error ................ ${diagnostic.error}`);
  }
  return lines.join("\n");
}

export function emitAthenaPersistedAuthorizationDiagnostic(
  diagnostic: AthenaPersistedAuthorizationDiagnostic
): void {
  lastPersistedDiagnostic = diagnostic;
  if (diagnostic.resolution === "failed") {
    console.error(
      "[athena]",
      formatAthenaPersistedAuthorizationDiagnostic(diagnostic)
    );
  }
}

export function resetAthenaRightsResolutionDiagnostics(): void {
  lastDiagnostic = undefined;
  lastPersistedDiagnostic = undefined;
}

export function defineAthenaRights(
  keys: readonly string[]
): readonly AthenaRightKey[] {
  return Object.freeze(keys.map((key) => parseAthenaRightKey(key)));
}

export function resolveAuthorizationMode(
  authorization?: AthenaPrincipalRightsProjection
): AthenaRightsResolutionMode {
  return authorization?.mode === "stored" ? "stored" : "role";
}

export function configuredRoleNames(
  authorization?: AthenaPrincipalRightsProjection
): readonly string[] {
  return Object.keys(authorization?.rightsByRole ?? {});
}

export function resolveStoredUserRightsResolution(
  user: {
    metadata?: unknown;
    rights?: readonly string[];
    role?: string | null;
  },
  authorization?: AthenaPrincipalRightsProjection,
  options?: { userId?: string }
): AthenaRightsResolution {
  const mode = resolveAuthorizationMode(authorization);
  const resolution =
    mode === "stored"
      ? resolveStoredMode(user)
      : resolveRoleMode(user, authorization);
  emitAthenaRightsResolutionDiagnostic(
    diagnosticFromResolution(resolution, user, authorization, options?.userId)
  );
  return resolution;
}

export function effectiveRightsFromResolution(
  resolution: AthenaRightsResolution
): readonly string[] {
  return resolution.rights;
}

export function validateAthenaRightsProjection(
  authorization: AthenaPrincipalRightsProjection | undefined
): AthenaRightsProjectionValidation {
  const issues: AthenaRightsProjectionValidationIssue[] = [];
  if (!authorization) {
    return { issues, ok: true };
  }
  const mode = resolveAuthorizationMode(authorization);
  if (mode === "stored") {
    return { issues, ok: true };
  }
  const table = authorization.rightsByRole;
  const roles = configuredRoleNames(authorization);
  if (!table || roles.length === 0) {
    return { issues, ok: true };
  }
  const defaultRole = authorization.defaultRole?.trim();
  if (defaultRole && !(table && Object.hasOwn(table, defaultRole))) {
    issues.push({
      message: `defaultRole "${defaultRole}" is not present in rightsByRole`,
      path: "auth.authorization.defaultRole",
    });
  }
  if (table) {
    for (const role of roles) {
      const mapped = table[role];
      if (!Array.isArray(mapped)) {
        issues.push({
          message: `rightsByRole.${role} must be a string array`,
          path: `auth.authorization.rightsByRole.${role}`,
        });
        continue;
      }
      for (const [index, entry] of mapped.entries()) {
        if (typeof entry !== "string") {
          issues.push({
            message: `rightsByRole.${role}[${index}] is not a string`,
            path: `auth.authorization.rightsByRole.${role}`,
          });
          continue;
        }
        try {
          parseAthenaRightKey(entry);
        } catch (error) {
          issues.push({
            message:
              error instanceof Error ? error.message : `invalid right ${entry}`,
            path: `auth.authorization.rightsByRole.${role}`,
          });
        }
      }
    }
  }
  return { issues, ok: issues.length === 0 };
}

export function formatAthenaRightsResolutionDiagnostic(
  diagnostic: AthenaRightsResolutionDiagnostic
): string {
  const lines = [
    "Auth authorization",
    `Stored role ........ ${diagnostic.storedRole ?? "(absent)"}`,
    `Configured roles ... ${
      diagnostic.configuredRoles.length > 0
        ? diagnostic.configuredRoles.join(", ")
        : "(none)"
    }`,
    `Selected role ...... ${diagnostic.selectedRole ?? "none"}`,
    `Effective rights ... ${String(diagnostic.effectiveRightCount)}`,
  ];
  if (diagnostic.reason) {
    lines.push(`Reason .............. ${diagnostic.reason}`);
  }
  return lines.join("\n");
}

export function projectAthenaRightsResolutionForDevtools(
  diagnostic: AthenaRightsResolutionDiagnostic | undefined
): {
  configuredRoles: readonly string[];
  defaultRole: string | null;
  effectiveRights: readonly string[];
  mode: AthenaRightsResolutionMode;
  reason: AthenaRightsResolutionReason | null;
  selectedRole: string | null;
  source: AthenaRightsResolutionSource;
  storedRole: string | null;
} | null {
  if (!diagnostic) {
    return null;
  }
  return {
    configuredRoles: diagnostic.configuredRoles,
    defaultRole: diagnostic.defaultRole ?? null,
    effectiveRights: diagnostic.effectiveRights,
    mode: diagnostic.mode,
    reason: diagnostic.reason ?? null,
    selectedRole: diagnostic.selectedRole ?? null,
    source: diagnostic.source,
    storedRole: diagnostic.storedRole ?? null,
  };
}

export function formatAthenaRightsProjectionValidateDetail(
  authorization: AthenaPrincipalRightsProjection
): string {
  const mode = resolveAuthorizationMode(authorization);
  const roles = configuredRoleNames(authorization);
  const defaultRole = authorization.defaultRole?.trim() ?? "";
  const table = authorization.rightsByRole ?? {};
  const mapped =
    defaultRole.length > 0 && Object.hasOwn(table, defaultRole) ? "yes" : "no";
  const lines = [
    `Mode ................ ${mode}`,
    `Default role ......... ${defaultRole || "(none)"}`,
    `Configured roles ..... ${roles.length > 0 ? roles.join(", ") : "(none)"}`,
  ];
  if (mode === "role") {
    lines.push(`Default role mapped .. ${mapped}`);
    lines.push("Rights");
    if (roles.length === 0) {
      lines.push("  (none)");
    } else {
      for (const role of roles) {
        const count = asStringList(table[role]).length;
        lines.push(
          `  ${role} ${".".repeat(Math.max(1, 18 - role.length))} ${String(count)}`
        );
      }
    }
  }
  return lines.join("\n");
}

function resolveRoleMode(
  user: {
    role?: string | null;
  },
  authorization?: AthenaPrincipalRightsProjection
): AthenaRightsResolution {
  const storedRole = user.role?.trim() ?? "";
  const table = authorization?.rightsByRole;
  if (storedRole) {
    const mapped = lookupMappedRights(table, storedRole);
    if (mapped !== undefined) {
      return {
        ok: true,
        rights: mapped,
        role: storedRole,
        source: "role",
      };
    }
    return {
      ok: false,
      reason: "role_not_mapped",
      rights: [],
      role: storedRole,
      source: "none",
    };
  }
  const defaultRole = authorization?.defaultRole?.trim() ?? "";
  if (defaultRole) {
    const mapped = lookupMappedRights(table, defaultRole);
    if (mapped !== undefined) {
      return {
        ok: true,
        rights: mapped,
        role: defaultRole,
        source: "default-role",
      };
    }
    return {
      ok: false,
      reason: "default_role_not_mapped",
      rights: [],
      role: defaultRole,
      source: "none",
    };
  }
  return {
    ok: false,
    reason: "no_rights_configured",
    rights: [],
    role: "",
    source: "none",
  };
}

function resolveStoredMode(user: {
  metadata?: unknown;
  rights?: readonly string[];
}): AthenaRightsResolution {
  if (user.rights !== undefined) {
    const rights = asStringList(user.rights);
    return {
      ok: true,
      rights,
      role: "",
      source: "stored",
    };
  }
  const metaRights = metadataRecord(user.metadata)?.rights;
  if (metaRights !== undefined) {
    return {
      ok: true,
      rights: asStringList(metaRights),
      role: "",
      source: "stored",
    };
  }
  return {
    ok: false,
    reason: "no_rights_configured",
    rights: [],
    role: "",
    source: "none",
  };
}

function lookupMappedRights(
  table: Readonly<Record<string, readonly string[]>> | undefined,
  role: string
): readonly string[] | undefined {
  if (!(table && Object.hasOwn(table, role))) {
    return;
  }
  return asStringList(table[role]);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function metadataRecord(
  metadata: unknown
): Record<string, unknown> | undefined {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata === "string" && metadata.trim()) {
    try {
      const parsed: unknown = JSON.parse(metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* metadata is not JSON */
    }
  }
}

function diagnosticFromResolution(
  resolution: AthenaRightsResolution,
  user: { role?: string | null },
  authorization: AthenaPrincipalRightsProjection | undefined,
  userId: string | undefined
): AthenaRightsResolutionDiagnostic {
  const storedRole = user.role?.trim() || undefined;
  const defaultRole = authorization?.defaultRole?.trim() || undefined;
  const selectedRole =
    resolution.source === "none" || resolution.role.length === 0
      ? undefined
      : resolution.role;
  return Object.freeze({
    configuredRoles: configuredRoleNames(authorization),
    defaultRole,
    effectiveRightCount: resolution.rights.length,
    effectiveRights: resolution.rights,
    kind: ATHENA_RIGHTS_RESOLUTION_KIND,
    mode: resolveAuthorizationMode(authorization),
    reason: resolution.ok ? undefined : resolution.reason,
    selectedRole,
    source: resolution.source,
    storedRole,
    userId: userId?.trim() || "unknown",
  });
}

function emitAthenaRightsResolutionDiagnostic(
  diagnostic: AthenaRightsResolutionDiagnostic
): void {
  lastDiagnostic = diagnostic;
  for (const listener of [...listeners]) {
    listener(diagnostic);
  }
  if (diagnostic.reason) {
    console.warn(
      "[athena]",
      formatAthenaRightsResolutionDiagnostic(diagnostic)
    );
  }
}
