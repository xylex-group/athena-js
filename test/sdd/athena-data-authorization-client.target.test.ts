import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import type { AthenaRightContribution } from "../../src/rights/contribution.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import type { AthenaRightDefinition } from "../../src/rights/types.ts";
import { AthenaConfigurationError } from "../../src/config/errors.ts";
import { AthenaAuthorizationBindingError } from "../../src/runtime/authorization/binding-errors.ts";
import {
	type AthenaAuthorizationRuntimeConfigInput,
	ATHENA_AUTHORIZATION_SERVER_AUTHORITY_REQUIRED,
	ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT,
} from "../../src/runtime/authorization/config.ts";
import { createAthenaModelAuthorizationBindingRegistry } from "../../src/runtime/authorization/binding-registry.ts";
import {
	attachAthenaAuthorizationModelIndex,
	createAthenaAuthorizationModelIndex,
	getAthenaAuthorizationModelIndex,
	propagateAthenaAuthorizationModelIndex,
	serializeAthenaAuthorizationModelIndex,
} from "../../src/runtime/authorization/model-index.ts";
import {
	normalizeAthenaAuthorizationConfig,
} from "../../src/runtime/authorization/normalize-config.ts";
import { organizationScope } from "../../src/runtime/authorization/model-binding.ts";

function rightDefinition(
	key: string,
	overrides: Partial<Omit<AthenaRightDefinition, "key">> = {},
): AthenaRightDefinition {
	return {
		assignable: true,
		description: "Lane L05 test right",
		displayName: "Lane L05 test right",
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

function testModels() {
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
	};
}

function logicalColumnModels() {
	return {
		Invoice: {
			meta: {
				columns: {
					id: { columnName: "id", kind: "string" },
					organizationId: { columnName: "organization_id", kind: "string" },
				},
				model: "Invoice",
				primaryKey: ["id"],
				schema: "billing",
				tableName: "invoices",
			},
		},
	};
}

function invoiceBindingInput() {
	return {
		identity: { column: "id" },
		resource: { model: "Invoice", table: "billing.invoices" },
		rights: {
			delete: "data.invoice.delete",
			insert: "data.invoice.insert",
			select: "data.invoice.select",
			update: "data.invoice.update",
		},
		scope: { column: "organization_id", kind: "organization" as const },
	};
}

function normalizeConfig(
	overrides: Partial<AthenaAuthorizationRuntimeConfigInput> = {},
) {
	return normalizeAthenaAuthorizationConfig({
		authorization: {
			data: [invoiceBindingInput()],
			rights: [contribution("data.invoice.select", "app.billing")],
		},
		databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena_sdd_l05",
		models: testModels(),
		...overrides,
	});
}

test("T-DAUTH-CFG-001: createClient authorization is additive and auth.authorization stays compatibility-only", () => {
	const normalized = normalizeConfig({
		auth: {
			authorization: {
				defaultRole: "owner",
				rightsByRole: { owner: ["not a valid right key"] },
			},
			mode: "remote",
		},
	});

	assert.equal(normalized.bindingRegistry?.bindings.length, 1);
	assert.equal(
		normalized.bindingRegistry?.get("billing.invoices")?.resource.model,
		"Invoice",
	);
	assert.ok(
		normalized.rightsState.rightsIr.rights.some(
			(entry) => entry.key === "data.invoice.select",
		),
	);
});

test("T-DAUTH-CFG-002: unknown model and unknown columns fail closed during normalization", () => {
	assert.throws(
		() =>
			normalizeConfig({
				authorization: {
					data: [
						{
							...invoiceBindingInput(),
							resource: { model: "Missing", table: "billing.invoices" },
						},
					],
					rights: [],
				},
			}),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_UNKNOWN_MODEL",
	);

	assert.throws(
		() =>
			normalizeConfig({
				authorization: {
					data: [
						{
							...invoiceBindingInput(),
							scope: { column: "missing_scope", kind: "organization" as const },
						},
					],
					rights: [],
				},
			}),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_UNKNOWN_COLUMN",
	);
});

test("T-DAUTH-CFG-003: duplicate resources and invalid right keys fail closed", () => {
	assert.throws(
		() =>
			normalizeConfig({
				authorization: {
					data: [invoiceBindingInput(), invoiceBindingInput()],
					rights: [],
				},
			}),
		(error: unknown) =>
			error instanceof AthenaAuthorizationBindingError &&
			error.bindingCode === "ATHENA_AUTHORIZATION_BINDING_DUPLICATE_RESOURCE",
	);

	const malformedContribution = {
		definition: {
			assignable: true,
			description: "bad right",
			displayName: "bad right",
			domain: "data",
			key: "invalid right key",
			riskLevel: "low",
			scopeKind: "organization",
		},
		source: "app.bad",
	} as unknown as AthenaRightContribution;

	assert.throws(
		() =>
			normalizeConfig({
				authorization: {
					data: [invoiceBindingInput()],
					rights: [malformedContribution],
				},
			}),
		(error: unknown) => error instanceof Error && /right key/i.test(error.message),
	);
});

test("T-DAUTH-CFG-004: unsupported subjects and hosted authority gaps fail closed", () => {
	assert.throws(
		() =>
			normalizeConfig({
				authorization: {
					data: [
						{
							...invoiceBindingInput(),
							scope: {
								column: "organization_id",
								kind: "organization",
								subject: "claims.organizationId",
							},
						},
					],
					rights: [],
				},
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID" &&
			error.message.includes(ATHENA_AUTHORIZATION_UNSUPPORTED_SUBJECT),
	);

	assert.throws(
		() =>
			normalizeAthenaAuthorizationConfig({
				authorization: {
					data: [invoiceBindingInput()],
					rights: [],
				},
				models: testModels(),
				url: "https://hosted.example",
			}),
		(error: unknown) =>
			error instanceof AthenaConfigurationError &&
			error.code === "ATHENA_RUNTIME_CONFIG_INVALID" &&
			error.message.includes(ATHENA_AUTHORIZATION_SERVER_AUTHORITY_REQUIRED),
	);
});

test("T-DAUTH-CFG-005: unmatched resource behavior is explicit and defaults to compatibility allow", () => {
	const compatible = normalizeConfig();
	assert.equal(compatible.unmatchedResources, "allow");

	const deny = normalizeConfig({
		authorization: {
			data: [invoiceBindingInput()],
			rights: [],
			unmatchedResources: "deny",
		},
	});
	assert.equal(deny.unmatchedResources, "deny");
});

test("T-DAUTH-CFG-006: registry resolves logical scope columns to physical identity", () => {
	const registry = createAthenaModelAuthorizationBindingRegistry(
		[
			{
				resource: { model: "Invoice", table: "billing.invoices" },
				rights: {
					delete: "data.invoice.delete",
					insert: "data.invoice.insert",
					select: "data.invoice.select",
					update: "data.invoice.update",
				},
				scope: organizationScope("organizationId"),
			},
		],
		{ models: logicalColumnModels() },
	);

	assert.deepEqual(registry.bindings[0]?.scope?.column, {
		logical: "organizationId",
		physical: "organization_id",
	});
});

test("T-DAUTH-TX-001: model authorization registry fingerprint survives all client views", () => {
	const normalized = normalizeConfig();
	const modelIndex = createAthenaAuthorizationModelIndex(normalized);
	assert.ok(modelIndex);

	const rootClient = {};
	const requestClient = {};
	const withContextView = {};
	const fromView = {};
	const dbView = {};
	const transactionView = {};
	const localHandlerView = {};

	attachAthenaAuthorizationModelIndex(rootClient, modelIndex);
	propagateAthenaAuthorizationModelIndex(rootClient, requestClient);
	propagateAthenaAuthorizationModelIndex(requestClient, withContextView);
	propagateAthenaAuthorizationModelIndex(withContextView, fromView);
	propagateAthenaAuthorizationModelIndex(withContextView, dbView);
	propagateAthenaAuthorizationModelIndex(dbView, transactionView);
	propagateAthenaAuthorizationModelIndex(rootClient, localHandlerView);

	const fingerprints = [
		rootClient,
		requestClient,
		withContextView,
		fromView,
		dbView,
		transactionView,
		localHandlerView,
	].map(
		(view) => getAthenaAuthorizationModelIndex(view)?.registryFingerprint,
	);

	assert.deepEqual(
		new Set(fingerprints),
		new Set([modelIndex.registryFingerprint]),
	);
	assert.equal(getAthenaAuthorizationModelIndex(requestClient), modelIndex);
	assert.equal(getAthenaAuthorizationModelIndex(transactionView), modelIndex);
});

test("T-DAUTH-SEC-001: trusted principals never enter serialized model-index payloads", () => {
	const serialized = serializeAthenaAuthorizationModelIndex(
		createAthenaAuthorizationModelIndex(normalizeConfig()),
	);
	assert.equal(serialized.includes('"principal"'), false);
	assert.equal(serialized.includes("organizationId"), false);
	assert.equal(serialized.includes("tenantId"), false);
	assert.equal(serialized.includes("userId"), false);
	assert.equal(serialized.includes("claims"), false);
});
