import type { AnyModelDef } from "../schema/types.ts";
import { auth } from "./expr-builders.ts";
import { policy, type AuthoredPolicy } from "./policy.ts";
import { resourceFromModel } from "./row.ts";

type RowOps = Record<string, { eq: (other: unknown) => unknown }>;

function resourceQual(model: AnyModelDef): string {
	const resource = resourceFromModel(model);
	return resource.schema
		? `${resource.schema}.${resource.table}`
		: resource.table;
}

function scopedAllow(column: string, subject: unknown) {
	return ((ctx: { row: RowOps }) => ctx.row[column]?.eq(subject)) as never;
}

/**
 * Row scoped by Athena Organizations (`organizationId` subject slot).
 * Distinct from {@link tenantScoped}.
 */
export function organizationScoped(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:organization`,
		delete: {
			allow: scopedAllow("organizationId", auth.organizationId),
			to: ["authenticated"],
		},
		insert: {
			check: scopedAllow("organizationId", auth.organizationId),
			to: ["authenticated"],
		},
		select: {
			allow: scopedAllow("organizationId", auth.organizationId),
			to: ["authenticated"],
		},
		update: {
			allow: scopedAllow("organizationId", auth.organizationId),
			to: ["authenticated"],
		},
	});
}

/**
 * Row scoped by a tenant identifier that is not Athena Organizations.
 * Binds `tenantId` to the trusted claim path `tenantId`.
 */
export function tenantScoped(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:tenant`,
		delete: {
			allow: scopedAllow("tenantId", auth.claim("tenantId")),
			to: ["authenticated"],
		},
		insert: {
			check: scopedAllow("tenantId", auth.claim("tenantId")),
			to: ["authenticated"],
		},
		select: {
			allow: scopedAllow("tenantId", auth.claim("tenantId")),
			to: ["authenticated"],
		},
		update: {
			allow: scopedAllow("tenantId", auth.claim("tenantId")),
			to: ["authenticated"],
		},
	});
}

/** Row owned by `userId` vs the owner column. */
export function userOwned(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:owner`,
		delete: {
			allow: scopedAllow("userId", auth.userId),
			to: ["authenticated"],
		},
		insert: {
			check: scopedAllow("userId", auth.userId),
			to: ["authenticated"],
		},
		select: {
			allow: scopedAllow("userId", auth.userId),
			to: ["authenticated"],
		},
		update: {
			allow: scopedAllow("userId", auth.userId),
			to: ["authenticated"],
		},
	});
}

/** Public SELECT permissive. */
export function publicRead(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:public-read`,
		select: { to: "public" },
	});
}

/** Authenticated principals only (all modeled actions). */
export function authenticatedOnly(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:authenticated`,
		delete: { to: ["authenticated"] },
		insert: { to: ["authenticated"] },
		select: { to: ["authenticated"] },
		update: { to: ["authenticated"] },
	});
}

/** Role principal (default `admin` when called with only the model). */
export function roleRestricted(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:role`,
		delete: { to: ["role:admin"] },
		insert: { to: ["role:admin"] },
		select: { to: ["role:admin"] },
		update: { to: ["role:admin"] },
	});
}

/** Service principal only. */
export function serviceOnly(model: AnyModelDef): AuthoredPolicy {
	return policy(model, {
		id: `${resourceQual(model)}:service`,
		delete: { to: ["service:service"] },
		insert: { to: ["service:service"] },
		select: { to: ["service:service"] },
		update: { to: ["service:service"] },
	});
}

/** Owner **or** role — two ordinary authored definitions, no IR sugar. */
export function ownerOrRole(model: AnyModelDef): AuthoredPolicy {
	const owner = userOwned(model);
	const role = roleRestricted(model);
	return {
		kind: "athena.policy",
		definitions: [...owner.definitions, ...role.definitions],
	};
}
