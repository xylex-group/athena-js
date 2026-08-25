import type { SchemaColumn } from "./column.ts";
import type {
	SchemaConstraint,
	SchemaReferentialAction,
} from "./constraint.ts";
import type { SchemaDatabase } from "./database.ts";
import type { AthenaSchemaIr } from "./document.ts";
import { asSchemaObjectId, type SchemaObjectIdentity } from "./identity.ts";
import type { SchemaIndex } from "./indexes.ts";
import type { SchemaMetadata } from "./metadata.ts";
import type { SchemaEnum, SchemaNamespace } from "./namespace.ts";
import type { SchemaRelation } from "./relation.ts";
import type { SchemaTable } from "./table.ts";
import type { NativeTypeDescriptor, SchemaType } from "./type.ts";
import { validateAthenaSchemaIr } from "./validate.ts";
import { ATHENA_SCHEMA_IR_KIND, ATHENA_SCHEMA_IR_VERSION } from "./version.ts";

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonOptionalFiniteNumber(value: unknown): number | null {
	if (value === null) {
		return null;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	throw new Error(
		"native length, precision, and scale must be finite numbers or null",
	);
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

const REFERENTIAL_ACTIONS = new Set<SchemaReferentialAction>([
	"no_action",
	"restrict",
	"cascade",
	"set_null",
	"set_default",
]);

function asReferentialAction(
	value: unknown,
	label: string,
): SchemaReferentialAction | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (
		typeof value === "string" &&
		REFERENTIAL_ACTIONS.has(value as SchemaReferentialAction)
	) {
		return value as SchemaReferentialAction;
	}
	throw new Error(`${label} "${String(value)}" is unsupported`);
}

function compareId(a: { id: string }, b: { id: string }): number {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function canonIdentity(raw: unknown): SchemaObjectIdentity {
	const obj = isObject(raw) ? raw : {};
	const logical = isObject(obj.logical) ? obj.logical : {};
	const physical = isObject(obj.physical) ? obj.physical : logical;
	const database = asString(logical.database);
	const namespace = asString(logical.namespace);
	const name = asString(logical.name);
	return {
		logical: { database, namespace, name },
		physical: {
			database: asString(physical.database, database),
			namespace: asString(physical.namespace, namespace),
			name: asString(physical.name, name),
		},
	};
}

function canonNative(raw: unknown): NativeTypeDescriptor {
	const obj = isObject(raw) ? raw : {};
	const dims =
		typeof obj.arrayDimensions === "number" &&
		Number.isFinite(obj.arrayDimensions)
			? obj.arrayDimensions
			: 0;
	const native: NativeTypeDescriptor = {
		backend: asString(obj.backend, "postgresql"),
		name: asString(obj.name),
		arrayDimensions: dims,
	};
	const withLength =
		obj.length === undefined
			? native
			: { ...native, length: canonOptionalFiniteNumber(obj.length) };
	const withPrecision =
		obj.precision === undefined
			? withLength
			: {
					...withLength,
					precision: canonOptionalFiniteNumber(obj.precision),
				};
	if (obj.scale === undefined) {
		return withPrecision;
	}
	return {
		...withPrecision,
		scale: canonOptionalFiniteNumber(obj.scale),
	};
}

function canonType(raw: unknown): SchemaType {
	const obj = isObject(raw) ? raw : {};
	const native = canonNative(obj.native);
	if (obj.kind === "enum" || typeof obj.enumId === "string") {
		return {
			kind: "enum",
			enumId: asString(obj.enumId),
			native,
		};
	}
	if (obj.kind === "native") {
		return { kind: "native", native };
	}
	return {
		kind: "scalar",
		semantic: asString(obj.semantic, native.name),
		native,
	};
}

function canonColumn(raw: unknown): SchemaColumn {
	const obj = isObject(raw) ? raw : {};
	const nullable = obj.nullable === true;
	const column: SchemaColumn = {
		id: asSchemaObjectId(asString(obj.id)),
		identity: canonIdentity(obj.identity),
		type: canonType(obj.type),
		nullable,
	};
	const withDefault =
		obj.default === undefined
			? column
			: {
					...column,
					default: obj.default === null ? null : asString(obj.default),
				};
	if (obj.generated === undefined && obj.isGenerated === undefined) {
		return withDefault;
	}
	return {
		...withDefault,
		generated: obj.generated === true || obj.isGenerated === true,
	};
}

function canonConstraint(raw: unknown): SchemaConstraint {
	const obj = isObject(raw) ? raw : {};
	const id = asSchemaObjectId(asString(obj.id));
	const kindRaw = asString(obj.kind).toLowerCase();
	const columns = Array.isArray(obj.columns)
		? obj.columns.map((c) => asString(c))
		: [];
	const name =
		obj.name === undefined
			? undefined
			: obj.name === null
				? null
				: asString(obj.name);

	if (kindRaw === "check") {
		return {
			id,
			kind: "check",
			expression: asString(obj.expression),
			...(name === undefined ? {} : { name }),
		};
	}
	if (kindRaw === "unique") {
		return {
			id,
			kind: "unique",
			columns,
			...(name === undefined ? {} : { name }),
		};
	}
	if (kindRaw === "foreign_key" || kindRaw === "fk") {
		return {
			id,
			kind: "foreign_key",
			columns,
			targetTableId: asString(obj.targetTableId),
			targetColumns: Array.isArray(obj.targetColumns)
				? obj.targetColumns.map((c) => asString(c))
				: [],
			...(name === undefined ? {} : { name }),
			...(obj.onDelete === undefined
				? {}
				: {
						onDelete: asReferentialAction(
							obj.onDelete,
							"SchemaConstraint.onDelete",
						),
					}),
			...(obj.onUpdate === undefined
				? {}
				: {
						onUpdate: asReferentialAction(
							obj.onUpdate,
							"SchemaConstraint.onUpdate",
						),
					}),
		};
	}
	return {
		id,
		kind: "primary_key",
		columns,
		...(name === undefined ? {} : { name }),
	};
}

function canonRelation(raw: unknown): SchemaRelation {
	const obj = isObject(raw) ? raw : {};
	const through = isObject(obj.through)
		? {
				tableId: asString(obj.through.tableId),
				sourceColumns: Array.isArray(obj.through.sourceColumns)
					? obj.through.sourceColumns.map((c) => asString(c))
					: [],
				targetColumns: Array.isArray(obj.through.targetColumns)
					? obj.through.targetColumns.map((c) => asString(c))
					: [],
			}
		: undefined;
	const relation: SchemaRelation = {
		id: asSchemaObjectId(asString(obj.id)),
		cardinality: asString(obj.cardinality) as SchemaRelation["cardinality"],
		sourceTableId: asString(obj.sourceTableId),
		targetTableId: asString(obj.targetTableId),
		backingConstraintIds: Array.isArray(obj.backingConstraintIds)
			? [...obj.backingConstraintIds].map((c) => asString(c)).sort()
			: [],
	};
	const withSource =
		obj.sourceColumns === undefined
			? relation
			: {
					...relation,
					sourceColumns: Array.isArray(obj.sourceColumns)
						? obj.sourceColumns.map((c) => asString(c))
						: [],
				};
	const withCols =
		obj.targetColumns === undefined
			? withSource
			: {
					...withSource,
					targetColumns: Array.isArray(obj.targetColumns)
						? obj.targetColumns.map((c) => asString(c))
						: [],
				};
	const withThrough =
		through === undefined ? withCols : { ...withCols, through };
	if (obj.name === undefined) {
		return withThrough;
	}
	return {
		...withThrough,
		name: obj.name === null ? null : asString(obj.name),
	};
}

function canonIndex(raw: unknown): SchemaIndex {
	const obj = isObject(raw) ? raw : {};
	const columns = Array.isArray(obj.columns)
		? obj.columns.map((col) => {
				if (typeof col === "string") {
					return { name: col, direction: "asc" as const };
				}
				const c = isObject(col) ? col : {};
				const direction =
					c.direction === "desc" ? ("desc" as const) : ("asc" as const);
				return { name: asString(c.name), direction };
			})
		: [];
	return {
		id: asSchemaObjectId(asString(obj.id)),
		columns,
		unique: obj.unique === true,
		...(obj.name === undefined
			? {}
			: { name: obj.name === null ? null : asString(obj.name) }),
		...(obj.predicate === undefined
			? {}
			: { predicate: obj.predicate === null ? null : asString(obj.predicate) }),
		...(obj.method === undefined
			? {}
			: { method: obj.method === null ? null : asString(obj.method) }),
	};
}

function canonEnum(raw: unknown): SchemaEnum {
	const obj = isObject(raw) ? raw : {};
	const labels = Array.isArray(obj.labels)
		? obj.labels.map((l) => asString(l))
		: Array.isArray(obj.values)
			? obj.values.map((l) => asString(l))
			: [];
	return {
		id: asSchemaObjectId(asString(obj.id)),
		identity: canonIdentity(obj.identity),
		labels,
		...(obj.name === undefined
			? {}
			: { name: obj.name === null ? null : asString(obj.name) }),
	};
}

function canonTable(raw: unknown): SchemaTable {
	const obj = isObject(raw) ? raw : {};
	return {
		id: asSchemaObjectId(asString(obj.id)),
		identity: canonIdentity(obj.identity),
		columns: (Array.isArray(obj.columns) ? obj.columns : [])
			.map(canonColumn)
			.sort(compareId),
		constraints: (Array.isArray(obj.constraints) ? obj.constraints : [])
			.map(canonConstraint)
			.sort(compareId),
		relations: (Array.isArray(obj.relations) ? obj.relations : [])
			.map(canonRelation)
			.sort(compareId),
		indexes: (Array.isArray(obj.indexes) ? obj.indexes : [])
			.map(canonIndex)
			.sort(compareId),
	};
}

function canonNamespace(raw: unknown): SchemaNamespace {
	const obj = isObject(raw) ? raw : {};
	const enums = (Array.isArray(obj.enums) ? obj.enums : [])
		.map(canonEnum)
		.sort(compareId);
	return {
		id: asSchemaObjectId(asString(obj.id)),
		identity: canonIdentity(obj.identity),
		enums,
		tables: (Array.isArray(obj.tables) ? obj.tables : [])
			.map(canonTable)
			.sort(compareId),
	};
}

function canonDatabase(raw: unknown): SchemaDatabase {
	const obj = isObject(raw) ? raw : {};
	const namespacesRaw = obj.namespaces ?? obj.schemas;
	const db: SchemaDatabase = {
		id: asSchemaObjectId(asString(obj.id)),
		identity: canonIdentity(obj.identity),
		namespaces: (Array.isArray(namespacesRaw) ? namespacesRaw : [])
			.map(canonNamespace)
			.sort(compareId),
	};
	const withEnums = Array.isArray(obj.enums)
		? { ...db, enums: obj.enums.map(canonEnum).sort(compareId) }
		: db;
	if (obj.backend === undefined) {
		return withEnums;
	}
	return {
		...withEnums,
		backend: obj.backend === null ? null : asString(obj.backend),
	};
}

function canonMetadata(raw: unknown): SchemaMetadata {
	if (!isObject(raw)) {
		return {};
	}
	const provenance = isObject(raw.provenance)
		? {
				...(raw.provenance.source === undefined
					? {}
					: { source: asString(raw.provenance.source) }),
				...(raw.provenance.generatedAt === undefined
					? {}
					: { generatedAt: asString(raw.provenance.generatedAt) }),
				...(raw.provenance.generator === undefined
					? {}
					: { generator: asString(raw.provenance.generator) }),
				...(raw.provenance.backend === undefined
					? {}
					: {
							backend:
								raw.provenance.backend === null
									? null
									: asString(raw.provenance.backend),
						}),
			}
		: undefined;
	const extensions = isObject(raw.extensions)
		? { ...raw.extensions }
		: undefined;
	return {
		...(provenance === undefined ? {} : { provenance }),
		...(extensions === undefined ? {} : { extensions }),
	};
}

/**
 * Normalize document structure (stable array order by id, folded aliases).
 * Idempotent: canonicalize(canonicalize(doc)) === canonicalize(doc).
 */
export function canonicalizeAthenaSchemaIr(doc: unknown): AthenaSchemaIr {
	validateAthenaSchemaIr(doc);
	const obj = doc as Record<string, unknown>;
	const canonical: AthenaSchemaIr = {
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: (Array.isArray(obj.databases) ? obj.databases : [])
			.map(canonDatabase)
			.sort(compareId),
		metadata: canonMetadata(obj.metadata),
	};
	return canonical;
}
