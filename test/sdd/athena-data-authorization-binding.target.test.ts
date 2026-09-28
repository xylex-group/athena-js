import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaRightContribution } from "../../src/rights/contribution.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaRightDefinition } from "../../src/rights/types.ts";
import {
	authorizationScopePrincipalPath,
	type AthenaModelAuthorizationBinding,
	authorizeModel,
	organizationScope,
	tenantScope,
	userScope,
} from "../../src/runtime/authorization/model-binding.ts";
import { AthenaAuthorizationBindingError } from "../../src/runtime/authorization/binding-errors.ts";
import { createAthenaModelAuthorizationBindingRegistry } from "../../src/runtime/authorization/binding-registry.ts";
import {
	resolveAthenaApplicationRightsIr,
	toAthenaApplicationRightContributions,
} from "../../src/runtime/authorization/application-rights.ts";

function rightDefinition(
	key: string,
	overrides: Partial<Omit<AthenaRightDefinition, "key">> = {},
): AthenaRightDefinition {
	return {
		assignable: true,
		description: "Model operation right",
		displayName: "Model operation right",
		domain: "data",
		key: parseAthenaRightKey(key),
		riskLevel: "low",
		scopeKind: "organization",
		...overrides,
	};
}

function contribution(
	key: string,
	source: string,
): AthenaRightContribution {
	return {
		definition: rightDefinition(key),
		source,
	};
}

function testModelRegistry() {
	return {
		Invoice: {
			meta: {
				columns: {
					id: { kind: "string" },
					organization_id: { kind: "string" },
					tenant_id: { kind: "string" },
					user_id: { kind: "string" },
				},
				model: "Invoice",
				primaryKey: ["id"],
				schema: "billing",
				tableName: "invoices",
			},
		},
		AuditLog: {
			meta: {
				columns: {
					id: { kind: "string" },
					user_id: { kind: "string" },
				},
				model: "AuditLog",
				primaryKey: ["id"],
				schema: "billing",
				tableName: "audit_log",
			},
		},
	};
}

function invoiceBinding(
	scope:
		| ReturnType<typeof organizationScope>
		| ReturnType<typeof tenantScope>
		| ReturnType<typeof userScope>,
): AthenaModelAuthorizationBinding {
	return authorizeModel({
		identity: { column: "id" },
		resource: {
			model: "Invoice",
			table: "billing.invoices",
		},
		rights: {
			delete: "data.invoice.delete",
			insert: "data.invoice.insert",
			select: "data.invoice.select",
			update: "data.invoice.update",
		},
		scope,
	});
}

test("binding IR is immutable and tenant scope has no claim path", () => {
	const binding = invoiceBinding(tenantScope("tenant_id"));
	assert.equal(binding.kind, "athena.authorization.model-binding");
	assert.equal(binding.irVersion, 1);
	assert.equal(Object.isFrozen(binding), true);
	assert.equal(Object.isFrozen(binding.resource), true);
	assert.equal(Object.isFrozen(binding.rights), true);
	assert.equal(Object.isFrozen(binding.scope), true);
	assert.equal(binding.scope?.kind, "tenant");
	assert.equal(
		authorizationScopePrincipalPath(tenantScope("tenant_id")),
		"principal.tenantId",
	);
	assert.equal("claim" in tenantScope("tenant_id"), false);
});

test("registry validates model metadata and canonical fingerprints", () => {
	const first = createAthenaModelAuthorizationBindingRegistry(
		[
			invoiceBinding(organizationScope("organization_id")),
			authorizeModel({
				resource: { model: "AuditLog", table: "billing.audit_log" },
				rights: {
					delete: "data.audit.delete",
					insert: "data.audit.insert",
					select: "data.audit.select",
					update: "data.audit.update",
				},
				scope: userScope("user_id"),
			}),
		],
		{ models: testModelRegistry() },
	);
	const second = createAthenaModelAuthorizationBindingRegistry(
		[
			authorizeModel({
				resource: { model: "AuditLog", table: "billing.audit_log" },
				rights: {
					delete: "data.audit.delete",
					insert: "data.audit.insert",
					select: "data.audit.select",
					update: "data.audit.update",
				},
				scope: userScope("user_id"),
			}),
			invoiceBinding(organizationScope("organization_id")),
		],
		{ models: testModelRegistry() },
	);

	assert.equal(first.fingerprint, second.fingerprint);
	assert.equal(first.bindings[0]?.resource.model, "AuditLog");
	assert.equal(first.bindings[1]?.resource.model, "Invoice");
	assert.equal(Object.isFrozen(first.bindings), true);
	assert.equal(Object.isFrozen(first), true);
});

test("registry rejects unknown model and unknown columns when metadata is available", () => {
	assert.throws(
		() =>
			createAthenaModelAuthorizationBindingRegistry(
				[
					authorizeModel({
						resource: { model: "Missing", table: "billing.invoices" },
						rights: {
							delete: "data.invoice.delete",
							insert: "data.invoice.insert",
							select: "data.invoice.select",
							update: "data.invoice.update",
						},
					}),
				],
				{ models: testModelRegistry() },
			),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_UNKNOWN_MODEL",
	);

	assert.throws(
		() =>
			createAthenaModelAuthorizationBindingRegistry(
				[
					authorizeModel({
						identity: { column: "unknown_col" },
						resource: { model: "Invoice", table: "billing.invoices" },
						rights: {
							delete: "data.invoice.delete",
							insert: "data.invoice.insert",
							select: "data.invoice.select",
							update: "data.invoice.update",
						},
						scope: organizationScope("organization_id"),
					}),
				],
				{ models: testModelRegistry() },
			),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_UNKNOWN_COLUMN",
	);
});

test("registry rejects duplicate and conflicting resources deterministically", () => {
	const duplicate = invoiceBinding(organizationScope("organization_id"));
	assert.throws(
		() =>
			createAthenaModelAuthorizationBindingRegistry(
				[duplicate, duplicate],
				{ models: testModelRegistry() },
			),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_DUPLICATE_RESOURCE",
	);

	assert.throws(
		() =>
			createAthenaModelAuthorizationBindingRegistry(
				[
					invoiceBinding(organizationScope("organization_id")),
					invoiceBinding(userScope("user_id")),
				],
				{ models: testModelRegistry() },
			),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_CONFLICTING_RESOURCE",
	);
});

test("application rights helpers preserve caller source", () => {
	const inputs = [
		contribution("data.invoice.select", "plugin.alpha"),
		contribution("data.invoice.select", "plugin.beta"),
		rightDefinition("data.invoice.update"),
	];
	const contributions = toAthenaApplicationRightContributions(inputs, "lane-l01");
	assert.deepEqual(
		contributions.map((entry) => entry.source),
		["plugin.alpha", "plugin.beta", "lane-l01"],
	);
	const rightsIr = resolveAthenaApplicationRightsIr(inputs, "lane-l01");
	assert.deepEqual(rightsIr.metadata.provenance, [
		"lane-l01",
		"plugin.alpha",
		"plugin.beta",
	]);
});
