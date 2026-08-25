import type { AthenaSchemaIr } from "./document.ts";
import { ATHENA_SCHEMA_IR_KIND, ATHENA_SCHEMA_IR_VERSION } from "./version.ts";

export class SchemaIrError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SchemaIrError";
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new SchemaIrError(`${label} must be an array`);
	}
	return value;
}

function requireNonEmptyId(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new SchemaIrError(`${label}.id is required`);
	}
	return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new SchemaIrError(`${label} must be a non-empty string`);
	}
	return value;
}

function requireOptionalNullableString(value: unknown, label: string): void {
	if (value === undefined || value === null) {
		return;
	}
	if (typeof value !== "string") {
		throw new SchemaIrError(`${label} must be a string or null`);
	}
}

function requireStringArray(value: unknown, label: string): string[] {
	const items = requireArray(value, label);
	return items.map((entry, index) =>
		requireNonEmptyString(entry, `${label}[${index}]`),
	);
}

function requireNonEmptyStringArray(value: unknown, label: string): string[] {
	const items = requireStringArray(value, label);
	if (items.length === 0) {
		throw new SchemaIrError(`${label} is required`);
	}
	return items;
}

function requireOptionalIntegerParameter(
	value: unknown,
	label: string,
	min: number,
): void {
	if (value === undefined || value === null) {
		return;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
		throw new SchemaIrError(
			`${label} must be an integer >= ${String(min)} or null`,
		);
	}
}

function requireUniqueId(id: string, seen: Set<string>, label: string): void {
	if (seen.has(id)) {
		throw new SchemaIrError(`Duplicate ${label} id "${id}"`);
	}
	seen.add(id);
}

function requireIdentity(value: unknown, label: string): void {
	if (!isObject(value)) {
		throw new SchemaIrError(`${label}.identity is required`);
	}
	for (const axis of ["logical", "physical"] as const) {
		const side = value[axis];
		if (!isObject(side)) {
			throw new SchemaIrError(`${label}.identity.${axis} is required`);
		}
		for (const key of ["database", "namespace", "name"] as const) {
			if (typeof side[key] !== "string") {
				throw new SchemaIrError(
					`${label}.identity.${axis}.${key} must be a string`,
				);
			}
		}
		if (axis === "physical") {
			requireNonEmptyString(side.name, `${label}.identity.physical.name`);
		}
	}
}

function physicalTableIdentityKey(identity: unknown): string {
	if (!isObject(identity) || !isObject(identity.physical)) {
		return "";
	}
	const physical = identity.physical;
	if (
		typeof physical.database !== "string" ||
		typeof physical.namespace !== "string" ||
		typeof physical.name !== "string"
	) {
		return "";
	}
	return `${physical.database}\0${physical.namespace}\0${physical.name}`;
}

function physicalNamespaceScopeKey(identity: unknown): string {
	if (!isObject(identity) || !isObject(identity.physical)) {
		return "";
	}
	const physical = identity.physical;
	if (
		typeof physical.database !== "string" ||
		typeof physical.namespace !== "string"
	) {
		return "";
	}
	return `${physical.database}\0${physical.namespace}`;
}

const TYPE_KINDS = new Set(["scalar", "enum", "native"]);

function requireType(
	value: unknown,
	label: string,
	enumRefs: Array<{ enumId: string; label: string }>,
): void {
	if (!isObject(value)) {
		throw new SchemaIrError(`${label}.type is required`);
	}
	if (typeof value.kind !== "string" || !TYPE_KINDS.has(value.kind)) {
		throw new SchemaIrError(
			`${label}.type.kind "${String(value.kind)}" is unsupported`,
		);
	}
	if (!isObject(value.native)) {
		throw new SchemaIrError(`${label}.type.native is required`);
	}
	if (
		typeof value.native.backend !== "string" ||
		value.native.backend.length === 0
	) {
		throw new SchemaIrError(`${label}.type.native.backend is required`);
	}
	if (typeof value.native.name !== "string" || value.native.name.length === 0) {
		throw new SchemaIrError(`${label}.type.native.name is required`);
	}
	if (
		typeof value.native.arrayDimensions !== "number" ||
		!Number.isInteger(value.native.arrayDimensions) ||
		value.native.arrayDimensions < 0
	) {
		throw new SchemaIrError(
			`${label}.type.native.arrayDimensions must be a nonnegative integer`,
		);
	}
	requireOptionalIntegerParameter(
		value.native.length,
		`${label}.type.native.length`,
		1,
	);
	requireOptionalIntegerParameter(
		value.native.precision,
		`${label}.type.native.precision`,
		1,
	);
	requireOptionalIntegerParameter(
		value.native.scale,
		`${label}.type.native.scale`,
		0,
	);
	if (value.kind === "scalar") {
		if (typeof value.semantic !== "string" || value.semantic.length === 0) {
			throw new SchemaIrError(`${label}.type.semantic is required`);
		}
	}
	if (value.kind === "enum") {
		if (typeof value.enumId !== "string" || value.enumId.length === 0) {
			throw new SchemaIrError(`${label}.type.enumId is required`);
		}
		enumRefs.push({ enumId: value.enumId, label });
	}
}

const CONSTRAINT_KINDS = new Set([
	"primary_key",
	"unique",
	"foreign_key",
	"check",
]);

const REFERENTIAL_ACTIONS = new Set([
	"no_action",
	"restrict",
	"cascade",
	"set_null",
	"set_default",
]);

const RELATION_CARDINALITIES = new Set(["1:1", "1:n", "n:1", "n:n"]);
const INDEX_DIRECTIONS = new Set(["asc", "desc"]);

function requireKnownColumns(
	columns: string[],
	known: Set<string>,
	label: string,
): void {
	for (const column of columns) {
		if (!known.has(column)) {
			throw new SchemaIrError(
				`${label} "${column}" does not identify a column`,
			);
		}
	}
}

function requireUniqueColumnNames(columns: string[], label: string): void {
	const seen = new Set<string>();
	for (const column of columns) {
		if (seen.has(column)) {
			throw new SchemaIrError(`${label} must not repeat column "${column}"`);
		}
		seen.add(column);
	}
}

function validateConstraint(
	item: Record<string, unknown>,
	sourceColumns: Set<string>,
	pendingFks: Array<{ targetTableId: string; targetColumns: string[] }>,
): void {
	if (typeof item.kind !== "string" || item.kind.length === 0) {
		throw new SchemaIrError("SchemaConstraint.kind is required");
	}
	if (!CONSTRAINT_KINDS.has(item.kind)) {
		throw new SchemaIrError(
			`SchemaConstraint.kind "${item.kind}" is unsupported`,
		);
	}
	if (item.name !== undefined && item.name !== null) {
		if (typeof item.name !== "string" || item.name.length === 0) {
			throw new SchemaIrError(
				"SchemaConstraint.name must be a non-empty string or null",
			);
		}
	}
	if (item.kind === "check") {
		if (typeof item.expression !== "string" || item.expression.length === 0) {
			throw new SchemaIrError("SchemaConstraint.expression is required");
		}
		return;
	}
	const columns = requireNonEmptyStringArray(
		item.columns,
		"SchemaConstraint.columns",
	);
	requireKnownColumns(columns, sourceColumns, "SchemaConstraint.columns");
	requireUniqueColumnNames(columns, "SchemaConstraint.columns");
	if (item.kind === "foreign_key") {
		const targetTableId = requireNonEmptyString(
			item.targetTableId,
			"SchemaConstraint.targetTableId",
		);
		const targetColumns = requireNonEmptyStringArray(
			item.targetColumns,
			"SchemaConstraint.targetColumns",
		);
		requireUniqueColumnNames(targetColumns, "SchemaConstraint.targetColumns");
		if (columns.length !== targetColumns.length) {
			throw new SchemaIrError(
				"SchemaConstraint.targetColumns must have the same length as SchemaConstraint.columns",
			);
		}
		if (item.onDelete !== undefined) {
			if (
				typeof item.onDelete !== "string" ||
				!REFERENTIAL_ACTIONS.has(item.onDelete)
			) {
				throw new SchemaIrError(
					`SchemaConstraint.onDelete "${String(item.onDelete)}" is unsupported`,
				);
			}
		}
		if (item.onUpdate !== undefined) {
			if (
				typeof item.onUpdate !== "string" ||
				!REFERENTIAL_ACTIONS.has(item.onUpdate)
			) {
				throw new SchemaIrError(
					`SchemaConstraint.onUpdate "${String(item.onUpdate)}" is unsupported`,
				);
			}
		}
		pendingFks.push({ targetTableId, targetColumns });
	}
}

function validateColumn(
	item: Record<string, unknown>,
	enumRefs: Array<{ enumId: string; label: string }>,
): void {
	requireIdentity(item.identity, "SchemaColumn");
	requireType(item.type, "SchemaColumn", enumRefs);
	if (typeof item.nullable !== "boolean") {
		throw new SchemaIrError("SchemaColumn.nullable must be a boolean");
	}
	if (
		item.default !== undefined &&
		item.default !== null &&
		typeof item.default !== "string"
	) {
		throw new SchemaIrError("SchemaColumn.default must be a string or null");
	}
	if (item.generated !== undefined && typeof item.generated !== "boolean") {
		throw new SchemaIrError("SchemaColumn.generated must be a boolean");
	}
	if (item.isGenerated !== undefined && typeof item.isGenerated !== "boolean") {
		throw new SchemaIrError("SchemaColumn.isGenerated must be a boolean");
	}
}

function validateEnum(item: Record<string, unknown>): void {
	requireIdentity(item.identity, "SchemaEnum");
	if (item.name !== undefined && item.name !== null) {
		if (typeof item.name !== "string" || item.name.length === 0) {
			throw new SchemaIrError(
				"SchemaEnum.name must be a non-empty string or null",
			);
		}
	}
	const labels = requireStringArray(item.labels, "SchemaEnum.labels");
	const seen = new Set<string>();
	for (const label of labels) {
		if (seen.has(label)) {
			throw new SchemaIrError(`Duplicate SchemaEnum label "${label}"`);
		}
		seen.add(label);
	}
}

type TableCatalogEntry = {
	columns: Set<string>;
	constraints: Set<string>;
};

type PendingRelationThrough = {
	sourceColumns: string[];
	tableId: string;
	targetColumns: string[];
};

type PendingRelation = {
	backingConstraintIds: string[];
	sourceColumns: string[] | undefined;
	sourceTableId: string;
	targetColumns: string[] | undefined;
	targetTableId: string;
	through: PendingRelationThrough | undefined;
};

function validateRelation(item: Record<string, unknown>): PendingRelation {
	if (item.name !== undefined && item.name !== null) {
		if (typeof item.name !== "string" || item.name.length === 0) {
			throw new SchemaIrError(
				"SchemaRelation.name must be a non-empty string or null",
			);
		}
	}
	if (
		typeof item.cardinality !== "string" ||
		!RELATION_CARDINALITIES.has(item.cardinality)
	) {
		throw new SchemaIrError(
			`SchemaRelation.cardinality "${String(item.cardinality)}" is unsupported`,
		);
	}
	const sourceTableId = requireNonEmptyString(
		item.sourceTableId,
		"SchemaRelation.sourceTableId",
	);
	const targetTableId = requireNonEmptyString(
		item.targetTableId,
		"SchemaRelation.targetTableId",
	);
	if (!Array.isArray(item.backingConstraintIds)) {
		throw new SchemaIrError(
			"SchemaRelation.backingConstraintIds must be an array",
		);
	}
	const backingConstraintIds = item.backingConstraintIds.map(
		(backingId, index) =>
			requireNonEmptyString(
				backingId,
				`SchemaRelation.backingConstraintIds[${index}]`,
			),
	);
	const sourceColumns =
		item.sourceColumns === undefined
			? undefined
			: requireStringArray(item.sourceColumns, "SchemaRelation.sourceColumns");
	const targetColumns =
		item.targetColumns === undefined
			? undefined
			: requireStringArray(item.targetColumns, "SchemaRelation.targetColumns");
	let through: PendingRelation["through"];
	if (item.cardinality === "n:n" || item.through !== undefined) {
		if (!isObject(item.through)) {
			throw new SchemaIrError("SchemaRelation.through is required");
		}
		through = {
			tableId: requireNonEmptyString(
				item.through.tableId,
				"SchemaRelation.through.tableId",
			),
			sourceColumns: requireStringArray(
				item.through.sourceColumns,
				"SchemaRelation.through.sourceColumns",
			),
			targetColumns: requireStringArray(
				item.through.targetColumns,
				"SchemaRelation.through.targetColumns",
			),
		};
	}
	return {
		backingConstraintIds,
		sourceColumns,
		sourceTableId,
		targetColumns,
		targetTableId,
		through,
	};
}

function validateIndex(
	item: Record<string, unknown>,
	sourceColumns: Set<string>,
	seenIndexNames: Set<string>,
	namespaceScope: string,
): void {
	const columns = requireArray(item.columns, "SchemaIndex.columns");
	if (columns.length === 0) {
		throw new SchemaIrError("SchemaIndex.columns is required");
	}
	const columnNames: string[] = [];
	for (const [index, raw] of columns.entries()) {
		const label = `SchemaIndex.columns[${index}]`;
		if (typeof raw === "string") {
			requireNonEmptyString(raw, `${label}.name`);
			requireKnownColumns([raw], sourceColumns, "SchemaIndex.columns");
			columnNames.push(raw);
			continue;
		}
		if (!isObject(raw)) {
			throw new SchemaIrError(`${label} must be a string or object`);
		}
		const name = requireNonEmptyString(raw.name, `${label}.name`);
		requireKnownColumns([name], sourceColumns, "SchemaIndex.columns");
		columnNames.push(name);
		if (
			raw.direction !== undefined &&
			raw.direction !== null &&
			(typeof raw.direction !== "string" ||
				!INDEX_DIRECTIONS.has(raw.direction))
		) {
			throw new SchemaIrError(`${label}.direction is unsupported`);
		}
	}
	requireUniqueColumnNames(columnNames, "SchemaIndex.columns");
	if (typeof item.unique !== "boolean") {
		throw new SchemaIrError("SchemaIndex.unique must be a boolean");
	}
	if (item.name !== undefined && item.name !== null) {
		if (typeof item.name !== "string" || item.name.length === 0) {
			throw new SchemaIrError(
				"SchemaIndex.name must be a non-empty string or null",
			);
		}
		const key = `${namespaceScope}\0${item.name}`;
		if (seenIndexNames.has(key)) {
			throw new SchemaIrError(
				`Duplicate SchemaIndex.name "${item.name}" conflicts with a table or index in the same namespace`,
			);
		}
		seenIndexNames.add(key);
	}
	if (
		item.predicate !== undefined &&
		item.predicate !== null &&
		typeof item.predicate !== "string"
	) {
		throw new SchemaIrError("SchemaIndex.predicate must be a string or null");
	}
	if (
		item.method !== undefined &&
		item.method !== null &&
		typeof item.method !== "string"
	) {
		throw new SchemaIrError("SchemaIndex.method must be a string or null");
	}
}

function columnPhysicalName(item: Record<string, unknown>): string {
	if (!isObject(item.identity) || !isObject(item.identity.physical)) {
		return "";
	}
	return typeof item.identity.physical.name === "string"
		? item.identity.physical.name
		: "";
}

function validateNamedObjects(
	values: unknown[],
	label: string,
	seen: Set<string>,
	validateItem?: (item: Record<string, unknown>) => void,
): void {
	for (const raw of values) {
		if (!isObject(raw)) {
			throw new SchemaIrError(`${label} must be an object`);
		}
		const id = requireNonEmptyId(raw.id, label);
		requireUniqueId(id, seen, label);
		validateItem?.(raw);
	}
}

/**
 * Fail-closed validation for Athena Schema IR v2.
 * Requires `kind: "athena.schema"`, `irVersion: 2`, and `databases[]`.
 * Nested tables, columns, constraints, relations, and indexes must be
 * complete objects with unique non-empty ids.
 */
export function validateAthenaSchemaIr(doc: unknown): AthenaSchemaIr {
	if (!isObject(doc)) {
		throw new SchemaIrError("AthenaSchemaIr must be an object");
	}
	if (doc.kind !== ATHENA_SCHEMA_IR_KIND) {
		throw new SchemaIrError(
			`AthenaSchemaIr.kind must be "${ATHENA_SCHEMA_IR_KIND}"`,
		);
	}
	if (doc.irVersion !== ATHENA_SCHEMA_IR_VERSION) {
		throw new SchemaIrError(
			`AthenaSchemaIr.irVersion must be ${ATHENA_SCHEMA_IR_VERSION}`,
		);
	}
	if (!("databases" in doc) || !Array.isArray(doc.databases)) {
		throw new SchemaIrError("AthenaSchemaIr.databases[] is required");
	}

	const seenIds = new Set<string>();
	const seenPhysicalTables = new Set<string>();
	const enumIds = new Set<string>();
	const pendingEnumRefs: Array<{ enumId: string; label: string }> = [];
	const tablesById = new Map<string, TableCatalogEntry>();
	const pendingFks: Array<{ targetTableId: string; targetColumns: string[] }> =
		[];
	const pendingRelations: PendingRelation[] = [];
	const seenIndexNames = new Set<string>();
	for (const rawDb of doc.databases) {
		if (!isObject(rawDb)) {
			throw new SchemaIrError("SchemaDatabase must be an object");
		}
		const dbId = requireNonEmptyId(rawDb.id, "SchemaDatabase");
		requireUniqueId(dbId, seenIds, "SchemaDatabase");
		requireIdentity(rawDb.identity, "SchemaDatabase");
		requireOptionalNullableString(rawDb.backend, "SchemaDatabase.backend");
		if (rawDb.enums !== undefined) {
			validateNamedObjects(
				requireArray(rawDb.enums, "SchemaDatabase.enums"),
				"SchemaEnum",
				seenIds,
				(item) => {
					validateEnum(item);
					enumIds.add(String(item.id));
				},
			);
		}
		const namespaces = rawDb.namespaces ?? rawDb.schemas;
		requireArray(namespaces, "SchemaDatabase.namespaces");
		for (const rawNs of namespaces as unknown[]) {
			if (!isObject(rawNs)) {
				throw new SchemaIrError("SchemaNamespace must be an object");
			}
			const nsId = requireNonEmptyId(rawNs.id, "SchemaNamespace");
			requireUniqueId(nsId, seenIds, "SchemaNamespace");
			requireIdentity(rawNs.identity, "SchemaNamespace");
			const namespaceScope = physicalNamespaceScopeKey(rawNs.identity);
			if (rawNs.enums !== undefined) {
				validateNamedObjects(
					requireArray(rawNs.enums, "SchemaNamespace.enums"),
					"SchemaEnum",
					seenIds,
					(item) => {
						validateEnum(item);
						enumIds.add(String(item.id));
					},
				);
			}
			const tables = requireArray(rawNs.tables, "SchemaNamespace.tables");
			for (const rawTable of tables) {
				if (!isObject(rawTable)) {
					throw new SchemaIrError("SchemaTable must be an object");
				}
				const tableId = requireNonEmptyId(rawTable.id, "SchemaTable");
				requireUniqueId(tableId, seenIds, "SchemaTable");
				requireIdentity(rawTable.identity, "SchemaTable");
				const tableNamespaceScope =
					physicalNamespaceScopeKey(rawTable.identity) || namespaceScope;
				const physicalKey = physicalTableIdentityKey(rawTable.identity);
				if (physicalKey.length > 0) {
					if (seenPhysicalTables.has(physicalKey)) {
						throw new SchemaIrError(
							`Duplicate SchemaTable physical identity "${physicalKey.replaceAll("\0", ".")}"`,
						);
					}
					seenPhysicalTables.add(physicalKey);
					if (seenIndexNames.has(physicalKey)) {
						throw new SchemaIrError(
							`SchemaTable physical name conflicts with an index in the same namespace "${physicalKey.replaceAll("\0", ".")}"`,
						);
					}
					seenIndexNames.add(physicalKey);
				}
				const columns = requireArray(rawTable.columns, "SchemaTable.columns");
				validateNamedObjects(columns, "SchemaColumn", seenIds, (item) => {
					validateColumn(item, pendingEnumRefs);
				});
				const sourceColumns = new Set<string>();
				for (const rawColumn of columns) {
					if (isObject(rawColumn)) {
						const name = columnPhysicalName(rawColumn);
						if (name.length > 0) {
							if (sourceColumns.has(name)) {
								throw new SchemaIrError(
									`Duplicate SchemaColumn physical name "${name}"`,
								);
							}
							sourceColumns.add(name);
						}
					}
				}
				const tableConstraintIds = new Set<string>();
				if (rawTable.constraints !== undefined) {
					let primaryKeyCount = 0;
					const tableConstraintNames = new Set<string>();
					validateNamedObjects(
						requireArray(rawTable.constraints, "SchemaTable.constraints"),
						"SchemaConstraint",
						seenIds,
						(item) => {
							tableConstraintIds.add(String(item.id));
							validateConstraint(item, sourceColumns, pendingFks);
							if (typeof item.name === "string" && item.name.length > 0) {
								if (tableConstraintNames.has(item.name)) {
									throw new SchemaIrError(
										`Duplicate SchemaConstraint.name "${item.name}"`,
									);
								}
								tableConstraintNames.add(item.name);
								if (item.kind === "primary_key" || item.kind === "unique") {
									const key = `${tableNamespaceScope}\0${item.name}`;
									if (seenIndexNames.has(key)) {
										throw new SchemaIrError(
											`SchemaConstraint.name "${item.name}" conflicts with a table or index in the same namespace`,
										);
									}
									seenIndexNames.add(key);
								}
							}
							if (item.kind === "primary_key") {
								primaryKeyCount += 1;
								if (primaryKeyCount > 1) {
									throw new SchemaIrError(
										"SchemaTable may declare at most one primary_key constraint",
									);
								}
							}
						},
					);
				}
				tablesById.set(tableId, {
					columns: sourceColumns,
					constraints: tableConstraintIds,
				});
				if (rawTable.relations !== undefined) {
					validateNamedObjects(
						requireArray(rawTable.relations, "SchemaTable.relations"),
						"SchemaRelation",
						seenIds,
						(item) => {
							pendingRelations.push(validateRelation(item));
						},
					);
				}
				if (rawTable.indexes !== undefined) {
					validateNamedObjects(
						requireArray(rawTable.indexes, "SchemaTable.indexes"),
						"SchemaIndex",
						seenIds,
						(item) => {
							validateIndex(
								item,
								sourceColumns,
								seenIndexNames,
								tableNamespaceScope,
							);
						},
					);
				}
			}
		}
	}

	for (const ref of pendingEnumRefs) {
		if (!enumIds.has(ref.enumId)) {
			throw new SchemaIrError(
				`${ref.label}.type.enumId "${ref.enumId}" does not identify an enum`,
			);
		}
	}

	for (const fk of pendingFks) {
		const target = tablesById.get(fk.targetTableId);
		if (!target) {
			throw new SchemaIrError(
				`SchemaConstraint.targetTableId "${fk.targetTableId}" does not identify a table`,
			);
		}
		requireKnownColumns(
			fk.targetColumns,
			target.columns,
			"SchemaConstraint.targetColumns",
		);
	}

	for (const relation of pendingRelations) {
		const source = tablesById.get(relation.sourceTableId);
		if (!source) {
			throw new SchemaIrError(
				`SchemaRelation.sourceTableId "${relation.sourceTableId}" does not identify a table`,
			);
		}
		const target = tablesById.get(relation.targetTableId);
		if (!target) {
			throw new SchemaIrError(
				`SchemaRelation.targetTableId "${relation.targetTableId}" does not identify a table`,
			);
		}
		if (relation.sourceColumns !== undefined) {
			requireKnownColumns(
				relation.sourceColumns,
				source.columns,
				"SchemaRelation.sourceColumns",
			);
		}
		if (relation.targetColumns !== undefined) {
			requireKnownColumns(
				relation.targetColumns,
				target.columns,
				"SchemaRelation.targetColumns",
			);
		}
		for (const backingId of relation.backingConstraintIds) {
			let found = false;
			for (const table of tablesById.values()) {
				if (table.constraints.has(backingId)) {
					found = true;
					break;
				}
			}
			if (!found) {
				throw new SchemaIrError(
					`SchemaRelation.backingConstraintIds "${backingId}" does not identify a constraint`,
				);
			}
		}
		if (relation.through !== undefined) {
			const through = tablesById.get(relation.through.tableId);
			if (!through) {
				throw new SchemaIrError(
					`SchemaRelation.through.tableId "${relation.through.tableId}" does not identify a table`,
				);
			}
			requireKnownColumns(
				relation.through.sourceColumns,
				through.columns,
				"SchemaRelation.through.sourceColumns",
			);
			requireKnownColumns(
				relation.through.targetColumns,
				through.columns,
				"SchemaRelation.through.targetColumns",
			);
		}
	}

	return doc as unknown as AthenaSchemaIr;
}
