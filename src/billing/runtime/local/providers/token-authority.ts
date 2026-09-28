import type { MollieBillingApiMode } from "../../../providers/types.ts";
import type { BillingCredentialAuthority } from "../../authority.ts";

export const STANDARD_MOLLIE_API_KEY_PERMISSIONS = {
  "customers.read": true,
  "customers.write": true,
  "mandates.read": true,
  "mandates.write": true,
  "orders.read": true,
  "orders.write": true,
  "payment-links.read": true,
  "payment-links.write": true,
  "payments.read": true,
  "payments.write": true,
  "refunds.read": true,
  "refunds.write": true,
  "sales-invoices.read": true,
  "shipments.read": true,
  "shipments.write": true,
  "subscriptions.read": true,
  "subscriptions.write": true,
} as const;

export type MollieDeclaredPermissionInput = Record<
  string,
  boolean | Record<string, boolean | undefined>
>;

export function normalizeMollieDeclaredPermissions(
  input: MollieDeclaredPermissionInput | undefined
): Record<string, boolean> {
  if (input == null) {
    return {};
  }
  const permissions: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "boolean") {
      permissions[key] = value;
      continue;
    }
    if (value == null || typeof value !== "object") {
      continue;
    }
    for (const [action, allowed] of Object.entries(value)) {
      if (typeof allowed !== "boolean") {
        continue;
      }
      permissions[`${key}.${action}`] = allowed;
    }
  }
  return permissions;
}

export function resolveMollieApiKeyAuthority(input: {
  profileId?: string | null;
  modes: { test: boolean; live: boolean };
}): BillingCredentialAuthority {
  return {
    modes: input.modes,
    permissions: { ...STANDARD_MOLLIE_API_KEY_PERMISSIONS },
    scope: {
      kind: "profile",
      ...(input.profileId != null && input.profileId.length > 0
        ? { profileId: input.profileId }
        : {}),
    },
    source: "derived",
  };
}

export function resolveMollieAdvancedTokenAuthority(input: {
  apiMode: MollieBillingApiMode;
  declaredPermissions?: MollieDeclaredPermissionInput;
  scope: { kind: "organization" } | { kind: "profile"; profileId?: string };
}): BillingCredentialAuthority {
  return {
    modes: modesForApiMode(input.apiMode),
    permissions: normalizeMollieDeclaredPermissions(input.declaredPermissions),
    scope: input.scope,
    source: "declared",
  };
}

export function resolveMollieCompatibleTokenAuthority(input: {
  modes: { test: boolean; live: boolean };
  declaredPermissions?: MollieDeclaredPermissionInput;
  profileId?: string | null;
}): BillingCredentialAuthority {
  const declared = normalizeMollieDeclaredPermissions(
    input.declaredPermissions
  );
  return {
    modes: input.modes,
    permissions: declared,
    scope: {
      kind: "profile",
      ...(input.profileId != null && input.profileId.length > 0
        ? { profileId: input.profileId }
        : {}),
    },
    source: "declared",
  };
}

export function modesForApiMode(apiMode: MollieBillingApiMode): {
  test: boolean;
  live: boolean;
} {
  if (apiMode === "both") {
    return { live: true, test: true };
  }
  if (apiMode === "live") {
    return { live: true, test: false };
  }
  return { live: false, test: true };
}
