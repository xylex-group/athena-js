import { parseAthenaRightKey } from "./key.ts";
import type { AthenaRightDefinition } from "./types.ts";

export function defineAthenaRight(input: {
  description: string;
  displayName: string;
  domain: string;
  key: string;
  risk?: AthenaRightDefinition["riskLevel"];
  scope: AthenaRightDefinition["scopeKind"];
  assignable?: boolean;
}): AthenaRightDefinition {
  return {
    assignable: input.assignable !== false,
    description: input.description,
    displayName: input.displayName,
    domain: input.domain,
    key: parseAthenaRightKey(input.key),
    riskLevel: input.risk ?? "low",
    scopeKind: input.scope,
  };
}

const ORGANIZATION_RIGHT_SEEDS: readonly [
  string,
  string,
  string,
  AthenaRightDefinition["scopeKind"],
  AthenaRightDefinition["riskLevel"],
][] = [
  [
    "organization.members.read",
    "View members",
    "List organization members and invitations",
    "organization",
    "low",
  ],
  [
    "organization.authentication.read",
    "View authentication posture",
    "View registered authentication methods and phishing-resistant posture",
    "organization",
    "low",
  ],
  [
    "organization.auth_events.read",
    "View organization Auth lifecycle events",
    "Read sanitized organization-scoped Auth lifecycle events",
    "organization",
    "low",
  ],
  [
    "organization.members.write",
    "Manage members",
    "Invite, change role, or remove organization members",
    "organization",
    "elevated",
  ],
  [
    "organization.owners.assign",
    "Assign owners",
    "Assign the organization owner role",
    "organization",
    "critical",
  ],
  [
    "organization.lifecycle.delete",
    "Delete organization",
    "Delete the organization",
    "organization",
    "critical",
  ],
  [
    "organization.members.invite",
    "Invite members",
    "Send organization invitations",
    "organization",
    "elevated",
  ],
  [
    "authorization.roles.read",
    "View organization roles",
    "View organization role templates and assignments",
    "organization",
    "low",
  ],
  [
    "authorization.roles.write",
    "Manage organization roles",
    "Create or clone organization roles",
    "organization",
    "elevated",
  ],
  [
    "authorization.roles.delegate",
    "Delegate organization rights",
    "Delegate organization rights the actor does not hold",
    "organization",
    "critical",
  ],
  [
    "authorization.platform.read",
    "View platform roles",
    "View platform role templates",
    "platform",
    "low",
  ],
  [
    "authorization.platform.write",
    "Manage platform roles",
    "Assign platform roles",
    "platform",
    "critical",
  ],
  [
    "authorization.platform.delegate",
    "Delegate platform rights",
    "Delegate platform rights the actor does not hold",
    "platform",
    "critical",
  ],
];

export const AUTHORIZATION_RIGHT_DEFINITIONS: readonly AthenaRightDefinition[] =
  ORGANIZATION_RIGHT_SEEDS.map(
    ([
      key,
      displayName,
      description,
      scope,
      riskLevel,
    ]): AthenaRightDefinition => ({
      assignable: true,
      description,
      displayName,
      domain: key.startsWith("authorization.")
        ? "authorization"
        : "organization",
      key: parseAthenaRightKey(key),
      riskLevel,
      scopeKind: scope,
    })
  );

export const ORGANIZATION_MEMBERS_READ = parseAthenaRightKey(
  "organization.members.read"
);
export const ORGANIZATION_AUTHENTICATION_READ = parseAthenaRightKey(
  "organization.authentication.read"
);
export const ORGANIZATION_AUTH_EVENTS_READ = parseAthenaRightKey(
  "organization.auth_events.read"
);
export const ORGANIZATION_OWNERS_ASSIGN = parseAthenaRightKey(
  "organization.owners.assign"
);
export const AUTHORIZATION_ROLES_READ = parseAthenaRightKey(
  "authorization.roles.read"
);
export const AUTHORIZATION_ROLES_DELEGATE = parseAthenaRightKey(
  "authorization.roles.delegate"
);
export const AUTHORIZATION_PLATFORM_READ = parseAthenaRightKey(
  "authorization.platform.read"
);
export const AUTHORIZATION_PLATFORM_DELEGATE = parseAthenaRightKey(
  "authorization.platform.delegate"
);
export const BILLING_PAYMENTS_READ = parseAthenaRightKey(
  "billing.payments.read"
);
