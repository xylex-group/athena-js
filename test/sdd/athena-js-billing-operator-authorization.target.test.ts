import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import {
  billingOperationPolicy,
  listBillingOperationPolicies,
} from "../../src/billing/runtime/operation-policy.ts";
import {
  BILLING_OPERATION_RIGHTS,
  callerEffectiveBillingCapability,
} from "../../src/billing/runtime/rights.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { capabilitiesFromRights } from "../../src/runtime/authorization/capabilities.ts";
import { assertBillingOperationsReferenceCatalog } from "../../src/runtime/authorization/catalog.ts";
import { MemoryAuthorizationStore } from "../../src/runtime/authorization/memory.ts";
import {
  BUILTIN_AUTHORIZATION_ROLES,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_BILLING_ADMIN_ROLE,
  PLATFORM_CUSTOMER_ROLE,
} from "../../src/runtime/authorization/templates.ts";
import { normalizeAthenaPrincipal } from "../../src/runtime/data/principal.ts";

test("P?: every advertised Billing operation references a catalogued right", () => {
  assertBillingOperationsReferenceCatalog();
  assert.equal(
    listBillingOperationPolicies().length,
    Object.keys(BILLING_OPERATION_RIGHTS).length
  );
});

test("P?: invoices.list agrees with billing.sales-invoices.read", () => {
  assert.deepEqual(
    [...BILLING_OPERATION_RIGHTS["invoices.list"]],
    ["billing.sales-invoices.read"]
  );
  assert.deepEqual(
    [...billingOperationPolicy("invoices.list").requiredRights],
    ["billing.sales-invoices.read"]
  );
});

test("P?: platform_admin resolves all required Billing rights", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  const rights = await store.resolveEffectiveRights({
    activeOrganizationId: "org-1",
    getMember: async () => ({
      created_at: new Date(),
      id: "member-1",
      organization_id: "org-1",
      role: "member",
      user_id: "admin-1",
    }),
    userId: "admin-1",
  });
  for (const required of Object.values(BILLING_OPERATION_RIGHTS)) {
    for (const key of required) {
      assert.ok(rights.includes(key), `platform_admin missing ${key}`);
    }
  }
});

test("P?: active organization does not remove platform Billing rights", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("admin-1", PLATFORM_ADMIN_ROLE);
  const withoutOrg = await store.resolveEffectiveRights({
    getMember: async () => undefined,
    userId: "admin-1",
  });
  const withOrg = await store.resolveEffectiveRights({
    activeOrganizationId: "org-1",
    getMember: async () => ({
      created_at: new Date(),
      id: "member-1",
      organization_id: "org-1",
      role: "member",
      user_id: "admin-1",
    }),
    userId: "admin-1",
  });
  assert.ok(withoutOrg.includes("billing.payments.read"));
  assert.ok(withOrg.includes("billing.payments.read"));
});

test("P?: billing_admin is a protected platform role with Billing rights only", () => {
  const role = BUILTIN_AUTHORIZATION_ROLES.find(
    (entry) => entry.id === PLATFORM_BILLING_ADMIN_ROLE
  );
  assert.ok(role);
  assert.equal(role?.protected, true);
  assert.equal(role?.scopeKind, "platform");
  assert.ok(
    role?.rights.includes(parseAthenaRightKey("billing.payments.read"))
  );
  assert.ok(
    role?.rights.includes(parseAthenaRightKey("billing.admin.ingestion.read"))
  );
  assert.equal(
    role?.rights.includes(parseAthenaRightKey("billing.self.checkout.write")),
    false
  );
  assert.equal(
    role?.rights.includes(parseAthenaRightKey("authorization.platform.write")),
    false
  );
  assert.equal(
    role?.rights.includes(parseAthenaRightKey("storage.put")),
    false
  );
});

test("P?: authorized merchant capability is not operator_only", () => {
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    rights: ["billing.payments.read"],
  });
  const overlay = callerEffectiveBillingCapability({
    authority: { kind: "session" },
    capability: { available: true },
    operation: "payments.list",
    principal,
  });
  assert.equal(overlay.authorized, true);
  assert.equal(overlay.available, true);
  assert.equal(overlay.reason, undefined);
  assert.notEqual(overlay.reason, "operator_only");
});

test("P?: platform_customer does not authorize merchant payments.list", async () => {
  const store = new MemoryAuthorizationStore();
  await store.assignUserRole("customer-1", PLATFORM_CUSTOMER_ROLE);
  const rights = await store.resolveEffectiveRights({
    getMember: async () => undefined,
    userId: "customer-1",
  });
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    rights: [...rights],
  });
  const overlay = callerEffectiveBillingCapability({
    authority: PROCESS_BILLING_INVOCATION,
    capability: { available: true },
    operation: "payments.list",
    principal,
  });
  assert.equal(overlay.authorized, false);
  assert.equal(overlay.available, true);
  assert.equal(overlay.effectiveAvailable, false);
  assert.equal(overlay.reason, undefined);
  assert.equal(overlay.unavailableReason, "missing_permission");
});

test("P?: runtime capability and authorization remain independently inspectable", () => {
  const principal = normalizeAthenaPrincipal({
    authenticated: true,
    rights: [],
  });
  const overlay = callerEffectiveBillingCapability({
    capability: {
      available: false,
      reason: "provider_connection_missing",
    },
    operation: "payments.list",
    principal,
  });
  assert.equal(overlay.available, false);
  assert.equal(overlay.authorized, false);
  assert.equal(overlay.effectiveAvailable, false);
  assert.equal(overlay.reason, "provider_connection_missing");
  assert.equal(overlay.unavailableReason, "missing_permission");
});

test("P?: platform_admin grants only platform and self rights", () => {
  const role = BUILTIN_AUTHORIZATION_ROLES.find(
    (entry) => entry.id === PLATFORM_ADMIN_ROLE
  );
  assert.ok(role);
  assert.equal(
    role?.rights.includes(parseAthenaRightKey("authorization.roles.read")),
    false
  );
  assert.equal(
    role?.rights.includes(parseAthenaRightKey("organization.members.read")),
    false
  );
  assert.ok(
    role?.rights.includes(parseAthenaRightKey("authorization.platform.write"))
  );
  assert.ok(
    role?.rights.includes(parseAthenaRightKey("billing.admin.ingestion.read"))
  );
});

test("P?: platform.write projects organization management capabilities without org-scoped grants", () => {
  const capabilities = capabilitiesFromRights([
    parseAthenaRightKey("authorization.platform.write"),
  ]);
  assert.equal(capabilities.canManagePlatformRoles, true);
  assert.equal(capabilities.canManageOrganizationRoles, true);
  assert.equal(capabilities.canChangeMemberRole, true);
  assert.equal(capabilities.canDeleteOrganization, false);
});
