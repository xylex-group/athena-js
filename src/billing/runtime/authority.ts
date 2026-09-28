import {
  ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
  AthenaBillingProviderError,
} from "../errors.ts";
import type {
  BillingOperationCapability,
  BillingOperationCapabilityReason,
} from "./capabilities.ts";

export type BillingAuthoritySource = "derived" | "declared" | "provider";

export type BillingAuthorityScope =
  | { kind: "organization" }
  | { kind: "profile"; profileId?: string };

export interface BillingCredentialAuthority {
  readonly modes: {
    readonly test: boolean;
    readonly live: boolean;
  };
  readonly permissions: Readonly<Record<string, boolean>>;
  readonly scope: BillingAuthorityScope;
  readonly source: BillingAuthoritySource;
}

/**
 * Absent authority is unenforced provider-native scope (Stripe, catalog).
 * A present but incomplete `authority` object is a config error — never
 * fail-open by treating it as fully granted.
 */
export function readBillingCredentialAuthority(
  providerConfig: Readonly<Record<string, unknown>> | undefined
): BillingCredentialAuthority | undefined {
  const raw = providerConfig?.authority;
  if (raw == null) {
    return;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message: "billing.providers authority is invalid.",
    });
  }
  const record = raw as Partial<BillingCredentialAuthority>;
  if (record.source == null || record.modes == null || record.scope == null) {
    throw new AthenaBillingProviderError({
      code: ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
      message: "billing.providers authority is incomplete.",
    });
  }
  return {
    modes: {
      live: record.modes.live === true,
      test: record.modes.test === true,
    },
    permissions: record.permissions ?? {},
    scope: record.scope,
    source: record.source,
  };
}

export function grantedPermissionsFromAuthority(
  authority: BillingCredentialAuthority
): ReadonlySet<string> {
  const granted = new Set<string>();
  for (const [permission, allowed] of Object.entries(authority.permissions)) {
    if (allowed) {
      granted.add(permission);
    }
  }
  return granted;
}

export function authorityAllowsMode(
  authority: BillingCredentialAuthority,
  environment: "test" | "live"
): boolean {
  return authority.modes[environment] === true;
}

export function authorityAllowsProfile(
  authority: BillingCredentialAuthority,
  requestedProfileId?: string | null
): boolean {
  if (authority.scope.kind === "organization") {
    return true;
  }
  const restricted = authority.scope.profileId;
  const requested =
    requestedProfileId != null && requestedProfileId.length > 0
      ? requestedProfileId
      : undefined;
  if (restricted == null || restricted.length === 0) {
    return requested == null;
  }
  if (requested == null) {
    return true;
  }
  return requested === restricted;
}

export function evaluateBillingOperationCapability(input: {
  anyCredentialConfigured: boolean;
  grantedPermissions: ReadonlySet<string>;
  implemented: boolean;
  requiredPermissions: readonly string[];
  scopeAllowed: boolean;
  selectedModeAllowed: boolean;
  unimplementedReason?: BillingOperationCapabilityReason;
  actualAuthority?: "organization" | "profile";
  requiredAuthority?: "organization" | "profile";
}): BillingOperationCapability {
  if (!input.implemented) {
    return unavailable(input.unimplementedReason ?? "unsupported_operation");
  }
  if (!input.anyCredentialConfigured) {
    return unavailable("missing_credential");
  }
  if (!input.selectedModeAllowed) {
    return unavailable("missing_provider_scope");
  }
  if (!input.scopeAllowed) {
    return unavailable("missing_provider_scope");
  }
  for (const permission of input.requiredPermissions) {
    if (!input.grantedPermissions.has(permission)) {
      return unavailable("missing_permission");
    }
  }
  return { available: true };
}

/**
 * Operator-facing view of {@link evaluateBillingOperationCapability}.
 * Keep-green getCapabilities stays on the lean `{ available, reason }` shape.
 */
export function diagnoseBillingOperationCapability(
  input: Parameters<typeof evaluateBillingOperationCapability>[0]
): BillingOperationCapability {
  if (
    input.implemented &&
    input.anyCredentialConfigured &&
    input.selectedModeAllowed &&
    !input.scopeAllowed
  ) {
    return {
      available: false,
      reason: "credential_scope_insufficient",
      remediation: remediationFor("credential_scope_insufficient"),
      ...(input.actualAuthority
        ? { actualAuthority: input.actualAuthority }
        : {}),
      requiredAuthority: input.requiredAuthority ?? "organization",
    };
  }
  const capability = evaluateBillingOperationCapability(input);
  if (capability.available || capability.reason == null) {
    return capability;
  }
  return {
    ...capability,
    remediation: remediationFor(capability.reason),
  };
}

function remediationFor(reason: BillingOperationCapabilityReason): string {
  switch (reason) {
    case "credential_scope_insufficient":
    case "missing_provider_scope":
      return "configure an organization-scoped access token";
    case "missing_connection":
    case "provider_connection_missing":
      return "declare billing.providers and wait for automatic connection materialization";
    case "connection_disabled":
      return "activate the persisted billing provider connection";
    case "profile_target_missing":
      return "set billing.providers.mollie.profileId for this credential";
    case "provider_runtime_unavailable":
    case "runtime_unavailable":
      return "attach the local Billing runtime on Node createClient";
    case "configuration_invalid":
      return "fix billing.providers configuration";
    case "unsupported_by_provider":
    case "unsupported_provider":
    case "unsupported_operation":
    case "provider_operation_unsupported":
      return "this operation is not implemented for the selected provider";
    case "missing_catalog":
      return "configure billing.catalog for this provider";
    case "missing_permission":
      return "see billing diagnostics for this operation";
    case "runtime_initializing":
      return "wait for billing runtime initialization to finish";
    case "bootstrap_failed":
      return "inspect billing runtime bootstrap errors";
    case "provider_not_configured":
      return "declare billing.providers for this provider";
    case "provider_connection_ambiguous":
      return "select a unique billing provider connection";
    case "missing_credential":
      return "configure the selected billing credential";
    case "operator_only":
      return "this operation is operator-only";
    case "self_enrollment_disabled":
      return "enable billing.selfEnrollment.enabled to allow recurring enrollment";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function unavailable(
  reason: BillingOperationCapabilityReason
): BillingOperationCapability {
  return {
    available: false,
    reason,
  };
}
