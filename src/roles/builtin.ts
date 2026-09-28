import type { AthenaRightsAuthority } from "../rights/authority.ts";
import { getAthenaAuthorizationRightsAuthority } from "../runtime/authorization/catalog.ts";
import { parseAthenaRightKey } from "../rights/key.ts";
import { parseAthenaRoleId } from "./id.ts";
import { parseAthenaRoleKey } from "./key.ts";
import type { AthenaRoleDefinition } from "./types.ts";

function billingRights(
  authority: AthenaRightsAuthority,
  predicate: (key: string) => boolean
): AthenaRoleDefinition["rights"] {
  return [...authority.byKey.values()]
    .filter((entry) => entry.domain === "billing" && predicate(entry.key))
    .map((entry) => entry.key);
}

function storageRights(
  authority: AthenaRightsAuthority
): AthenaRoleDefinition["rights"] {
  return [...authority.byKey.values()]
    .filter((entry) => entry.domain === "storage")
    .map((entry) => entry.key);
}

function platformRights(
  authority: AthenaRightsAuthority,
  rights: readonly string[]
): AthenaRoleDefinition["rights"] {
  return rights
    .filter((key) => {
      const definition = authority.byKey.get(parseAthenaRightKey(key));
      return (
        definition?.scopeKind === "self" || definition?.scopeKind === "platform"
      );
    })
    .map((key) => parseAthenaRightKey(key));
}

function availableRights(
  authority: AthenaRightsAuthority,
  rights: readonly AthenaRoleDefinition["rights"][number][]
): AthenaRoleDefinition["rights"] {
  return rights.filter((right) => authority.byKey.has(right));
}

function definition(input: {
  id: string;
  key: string;
  displayName: string;
  description: string;
  scope: AthenaRoleDefinition["scope"];
  systemKind: AthenaRoleDefinition["systemKind"];
  rights: AthenaRoleDefinition["rights"];
}): AthenaRoleDefinition {
  return Object.freeze({
    ...input,
    assignable: true,
    id: parseAthenaRoleId(input.id),
    key: parseAthenaRoleKey(input.key),
    protected: true,
    rights: Object.freeze([...input.rights]),
    scope: Object.freeze(input.scope),
  });
}

const customerBilling = [
  "billing.catalog.read",
  "billing.self.invoices.read",
  "billing.self.payments.read",
  "billing.self.subscription.read",
  "billing.self.subscription.write",
  "billing.self.checkout.write",
  "billing.customers.write",
].map((key) => parseAthenaRightKey(key));

export function createAthenaBuiltinRoleDefinitions(
  authority = getAthenaAuthorizationRightsAuthority()
): readonly AthenaRoleDefinition[] {
  return Object.freeze([
    definition({
      description: "Platform operator",
      displayName: "Platform administrator",
      id: "platform_admin",
      key: "platform_admin",
      rights: platformRights(authority, [
        ...billingRights(authority, () => true),
        ...storageRights(authority),
        "authorization.platform.read",
        "authorization.platform.write",
        "authorization.platform.delegate",
      ]),
      scope: { kind: "platform" },
      systemKind: "admin",
    }),
    definition({
      description: "Delegated billing operator",
      displayName: "Billing administrator",
      id: "billing_admin",
      key: "billing_admin",
      rights: platformRights(
        authority,
        billingRights(authority, (key) => !key.startsWith("billing.self."))
      ),
      scope: { kind: "platform" },
      systemKind: "admin",
    }),
    definition({
      description: "Customer account",
      displayName: "Customer",
      id: "platform_customer",
      key: "platform_customer",
      rights: [
        ...availableRights(authority, customerBilling),
        ...availableRights(
          authority,
          storageRights(authority).filter(
            (key) => key !== "storage.put" && key !== "storage.delete"
          )
        ),
      ],
      scope: { kind: "platform" },
      systemKind: "member",
    }),
    definition({
      description: "No rights",
      displayName: "Unauthorized",
      id: "platform_unauthorized",
      key: "platform_unauthorized",
      rights: [],
      scope: { kind: "platform" },
      systemKind: null,
    }),
    definition({
      description: "Organization owner",
      displayName: "Organization owner",
      id: "organization_owner",
      key: "organization_owner",
      rights: availableRights(authority, [
        parseAthenaRightKey("organization.members.read"),
        parseAthenaRightKey("organization.members.write"),
        parseAthenaRightKey("organization.members.invite"),
        parseAthenaRightKey("organization.owners.assign"),
        parseAthenaRightKey("organization.lifecycle.delete"),
        parseAthenaRightKey("authorization.roles.read"),
        parseAthenaRightKey("authorization.roles.write"),
      ]),
      scope: { kind: "organization-template" },
      systemKind: "owner",
    }),
    definition({
      description: "Organization administrator",
      displayName: "Organization administrator",
      id: "organization_admin",
      key: "organization_admin",
      rights: availableRights(authority, [
        parseAthenaRightKey("organization.members.read"),
        parseAthenaRightKey("organization.members.write"),
        parseAthenaRightKey("organization.members.invite"),
        parseAthenaRightKey("authorization.roles.read"),
      ]),
      scope: { kind: "organization-template" },
      systemKind: "admin",
    }),
    definition({
      description: "Organization member",
      displayName: "Organization member",
      id: "organization_member",
      key: "organization_member",
      rights: availableRights(authority, [
        parseAthenaRightKey("organization.members.read"),
      ]),
      scope: { kind: "organization-template" },
      systemKind: "member",
    }),
  ]);
}

export const ATHENA_BUILTIN_ROLE_DEFINITIONS =
  createAthenaBuiltinRoleDefinitions();
