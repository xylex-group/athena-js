import { capabilityContribution } from "../capabilities/contribution.ts";
import { disabledCapabilityContribution } from "../capabilities/contribution.ts";
import type { AthenaCapabilityContribution } from "../capabilities/resolver.ts";
import type { AthenaAuthCapabilitiesResult } from "./capabilities.ts";

function authContribution(
  key: string,
  enabled: boolean | null | undefined,
  source: AthenaAuthCapabilitiesResult["source"],
  snapshotStatus: AthenaAuthCapabilitiesResult["status"]
): AthenaCapabilityContribution {
  if (enabled == null || snapshotStatus === "unknown") {
    return capabilityContribution(
      {
        key,
        domain: "auth",
        kind: "feature",
        implementation: "unknown",
        status: "unknown",
        reason: { code: "capability.unknown" },
      },
      { kind: "runtime", source: `auth:${source}` }
    );
  }
  const sourceInfo = { kind: "runtime" as const, source: `auth:${source}` };
  return enabled
    ? capabilityContribution(
        { key, domain: "auth", kind: "feature" },
        sourceInfo
      )
    : disabledCapabilityContribution(
        { key, domain: "auth", kind: "feature" },
        sourceInfo
      );
}

export function authCapabilitiesToContributions(
  capabilities: AthenaAuthCapabilitiesResult
): AthenaCapabilityContribution[] {
  const socialProviders = capabilities.social?.providers;
  return [
    authContribution(
      "auth.password.sign-in",
      capabilities.emailAndPassword,
      capabilities.source,
      capabilities.status
    ),
    authContribution(
      "auth.password.reset",
      capabilities.password,
      capabilities.source,
      capabilities.status
    ),
    authContribution(
      "auth.session.list",
      capabilities.sessions,
      capabilities.source,
      capabilities.status
    ),
    authContribution(
      "auth.organization.manage",
      capabilities.organizations,
      capabilities.source,
      capabilities.status
    ),
    authContribution(
      "auth.passkey.authentication",
      capabilities.passkeys,
      capabilities.source,
      capabilities.status
    ),
    authContribution(
      "auth.social.sign-in",
      socialProviders == null ? undefined : socialProviders.length > 0,
      capabilities.source,
      capabilities.status
    ),
  ];
}
