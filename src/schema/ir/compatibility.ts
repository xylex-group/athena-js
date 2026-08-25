/**
 * v1 snapshot ↔ Schema IR v2 lifts and authoring/introspection adapters.
 * IntrospectionSnapshot / ModelMetadataBase are allowed here only.
 */

import {
	normalizeReferentialAction,
	parseSchemaTypeString,
} from "../diff/normalize.ts";
import {
	ATHENA_SCHEMA_SNAPSHOT_VERSION,
	type AthenaSchemaSnapshot,
	type SchemaColumn as V1Column,
	type SchemaColumnType as V1ColumnType,
	type SchemaForeignKey as V1ForeignKey,
	type SchemaIndex as V1Index,
	type SchemaTable as V1Table,
	type SchemaUniqueConstraint as V1Unique,
} from "../diff/types.ts";
import { collectModelsFromSqlInput, type ModelSqlInput } from "../model-sql.ts";
import type {
	IntrospectionColumn,
	IntrospectionRelation,
	IntrospectionSnapshot,
	IntrospectionTable,
	ModelColumnKind,
	ModelRelationKind,
	ModelRelationMetadata,
} from "../types.ts";
import { canonicalizeAthenaSchemaIr } from "./canonicalize.ts";
import type { SchemaColumn } from "./column.ts";
import type {
	SchemaConstraint,
	SchemaReferentialAction,
} from "./constraint.ts";
import type { SchemaDatabase } from "./database.ts";
import type { AthenaSchemaIr } from "./document.ts";
import {
	asSchemaObjectId,
	type SchemaObjectId,
	schemaObjectIdentity,
} from "./identity.ts";
import type { SchemaIndex } from "./indexes.ts";
import type { SchemaEnum, SchemaNamespace } from "./namespace.ts";
import type {
	SchemaRelation,
	SchemaRelationCardinality,
	SchemaRelationThrough,
} from "./relation.ts";
import type { SchemaTable } from "./table.ts";
import type { NativeTypeDescriptor, SchemaType } from "./type.ts";
import { validateAthenaSchemaIr } from "./validate.ts";
import { ATHENA_SCHEMA_IR_KIND, ATHENA_SCHEMA_IR_VERSION } from "./version.ts";

const INTERNAL_SCHEMAS = new Set(["athena"]);
const DEFAULT_DATABASE = "default";
const DEFAULT_SCHEMA = "public";
const DEFAULT_BACKEND = "postgresql";

export interface SchemaIrFromModelsOptions {
	readonly backend?: string | null;
	readonly defaultSchema?: string;
	readonly defaultDatabase?: string;
}

export interface SchemaIrFromIntrospectionOptions {
	readonly schemas?: readonly string[];
	readonly excludeInternal?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAthenaSchemaIr(value: unknown): value is AthenaSchemaIr {
	return (
		isObject(value) &&
		value.kind === ATHENA_SCHEMA_IR_KIND &&
		value.irVersion === ATHENA_SCHEMA_IR_VERSION &&
		Array.isArray(value.databases)
	);
}

function id(value: string): SchemaObjectId {
	return asSchemaObjectId(value);
}

function nativeFromV1(
	type: V1ColumnType,
	backend: string,
): NativeTypeDescriptor {
	return {
		backend,
		name: type.name,
		arrayDimensions: type.arrayDimensions,
		...(type.length === undefined ? {} : { length: type.length }),
		...(type.precision === undefined ? {} : { precision: type.precision }),
		...(type.scale === undefined ? {} : { scale: type.scale }),
	};
}

function typeFromV1Column(
	type: V1ColumnType,
	backend: string,
	enumId?: string,
): SchemaType {
	const native = nativeFromV1(type, backend);
	if (enumId) {
		return { kind: "enum", enumId, native };
	}
	return { kind: "scalar", semantic: type.name, native };
}

function tableStableId(database: string, schema: string, name: string): string {
	return `tbl:${database}.${schema}.${name}`;
}

function columnStableId(
	database: string,
	schema: string,
	table: string,
	name: string,
): string {
	return `col:${database}.${schema}.${table}.${name}`;
}

function enumStableId(
	database: string,
	schema: string,
	table: string,
	name: string,
): string {
	return `enum:${database}.${schema}.${table}.${name}`;
}

function fkStableId(
	tableId: string,
	sourceColumns: readonly string[],
	targetTableId: string,
	targetColumns: readonly string[],
): string {
	return `cst:${tableId}:fk:${sourceColumns.join(",")}:${targetTableId}:${targetColumns.join(",")}`;
}

function mapAuthoredColumns(
	names: readonly string[],
	logicalToPhysical: Map<string, string> | undefined,
): string[] {
	return names.map((name) => logicalToPhysical?.get(name) ?? name);
}

function snapshotDatabaseName(
	value: string | undefined,
	fallback: string,
): string {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function snapshotTableDatabase(table: V1Table, fallback: string): string {
	return snapshotDatabaseName(table.database, fallback);
}

export function schemaIrFromSnapshot(
	snapshot: AthenaSchemaSnapshot,
	options: { database?: string } = {},
): AthenaSchemaIr {
	const backend = snapshot.backend ?? DEFAULT_BACKEND;
	const fallbackDatabase = options.database?.trim() || DEFAULT_DATABASE;
	type NamespaceBucket = {
		enums: SchemaEnum[];
		tables: SchemaTable[];
		seenEnums: Set<string>;
	};
	const databases = new Map<string, Map<string, NamespaceBucket>>();

	const namespaceBucket = (dbName: string, nsName: string): NamespaceBucket => {
		let namespaces = databases.get(dbName);
		if (!namespaces) {
			namespaces = new Map();
			databases.set(dbName, namespaces);
		}
		let bucket = namespaces.get(nsName);
		if (!bucket) {
			bucket = { enums: [], tables: [], seenEnums: new Set() };
			namespaces.set(nsName, bucket);
		}
		return bucket;
	};

	for (const ns of snapshot.schemas) {
		if (ns.tables.length === 0) {
			namespaceBucket(
				snapshotDatabaseName(ns.database, fallbackDatabase),
				ns.name,
			);
		}

		for (const table of ns.tables) {
			const databaseName = snapshotTableDatabase(table, fallbackDatabase);
			const bucket = namespaceBucket(databaseName, table.schema || ns.name);
			const { enums, tables, seenEnums } = bucket;
			const tableId = tableStableId(databaseName, table.schema, table.name);
			const columns: SchemaColumn[] = [];
			for (const column of table.columns) {
				let enumId: string | undefined;
				if (column.type.enumValues && column.type.enumValues.length > 0) {
					enumId = introspectedEnumStableId(
						databaseName,
						table.schema,
						column.type.name,
					);
					if (!seenEnums.has(enumId)) {
						seenEnums.add(enumId);
						enums.push({
							id: id(enumId),
							identity: schemaObjectIdentity(
								databaseName,
								table.schema,
								column.type.name,
							),
							labels: [...column.type.enumValues],
						});
					}
				}
				columns.push({
					id: id(
						columnStableId(databaseName, table.schema, table.name, column.name),
					),
					identity: schemaObjectIdentity(
						databaseName,
						table.schema,
						column.name,
					),
					type: typeFromV1Column(
						column.type,
						backend ?? DEFAULT_BACKEND,
						enumId,
					),
					nullable: column.nullable,
					default: column.default,
					generated: column.isGenerated,
				});
			}

			const constraints: SchemaConstraint[] = [];
			if (table.primaryKey && table.primaryKey.columns.length > 0) {
				constraints.push({
					id: id(`cst:${tableId}:pk`),
					kind: "primary_key",
					columns: [...table.primaryKey.columns],
					name: table.primaryKey.name ?? null,
				});
			}
			for (const unique of table.uniqueConstraints) {
				constraints.push({
					id: id(`cst:${tableId}:uq:${unique.columns.join(",")}`),
					kind: "unique",
					columns: [...unique.columns],
					name: unique.name ?? null,
				});
			}
			const relations: SchemaRelation[] = [];
			for (const fk of table.foreignKeys) {
				const targetDatabase = snapshotDatabaseName(
					fk.target.database,
					databaseName,
				);
				const targetId = tableStableId(
					targetDatabase,
					fk.target.schema,
					fk.target.name,
				);
				const fkId = fkStableId(
					tableId,
					fk.columns,
					targetId,
					fk.targetColumns,
				);
				constraints.push({
					id: id(fkId),
					kind: "foreign_key",
					columns: [...fk.columns],
					targetTableId: targetId,
					targetColumns: [...fk.targetColumns],
					name: fk.name ?? null,
					onDelete: fk.onDelete,
					onUpdate: fk.onUpdate,
				});
				relations.push({
					id: id(`rel:${tableId}:${fk.columns.join(",")}:${targetId}`),
					cardinality: "n:1",
					sourceTableId: tableId,
					targetTableId: targetId,
					sourceColumns: [...fk.columns],
					targetColumns: [...fk.targetColumns],
					backingConstraintIds: [fkId],
					name: fk.name ?? null,
				});
			}

			const indexes: SchemaIndex[] = table.indexes.map((ix, index) => ({
				id: id(`idx:${tableId}:${ix.name ?? index}`),
				columns: ix.columns.map((c) => ({
					name: c.name,
					direction: c.direction ?? "asc",
				})),
				unique: ix.unique,
				name: ix.name ?? null,
				predicate: ix.predicate ?? null,
				method: ix.method ?? null,
			}));

			tables.push({
				id: id(tableId),
				identity: schemaObjectIdentity(databaseName, table.schema, table.name),
				columns,
				constraints,
				relations,
				indexes,
			});
		}
	}

	const lifted: SchemaDatabase[] = [...databases.entries()].map(
		([dbName, namespaces]) => ({
			id: id(`db:${dbName}`),
			identity: schemaObjectIdentity(dbName, DEFAULT_SCHEMA, dbName),
			namespaces: [...namespaces.entries()].map(([nsName, bucket]) => ({
				id: id(`ns:${dbName}.${nsName}`),
				identity: schemaObjectIdentity(dbName, nsName, nsName),
				enums: bucket.enums,
				tables: bucket.tables,
			})),
			backend,
		}),
	);

	return canonicalizeAthenaSchemaIr({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: lifted,
		metadata: {
			provenance: {
				source: "snapshot",
				backend,
			},
			extensions: {},
		},
	});
}

function collectIrTables(ir: AthenaSchemaIr): SchemaTable[] {
	const tables: SchemaTable[] = [];
	for (const db of ir.databases) {
		for (const ns of db.namespaces) {
			tables.push(...ns.tables);
		}
	}
	return tables;
}

function collectIrNamespaceNames(ir: AthenaSchemaIr): Set<string> {
	const names = new Set<string>();
	for (const identity of collectIrNamespaceIdentities(ir).values()) {
		names.add(identity.schema);
	}
	return names;
}

function collectIrNamespaceIdentities(
	ir: AthenaSchemaIr,
): Map<string, { database: string; schema: string }> {
	const identities = new Map<string, { database: string; schema: string }>();
	for (const db of ir.databases) {
		const database = db.identity.physical.database;
		for (const ns of db.namespaces) {
			const schema = ns.identity.physical.namespace;
			identities.set(`${database}\0${schema}`, { database, schema });
		}
	}
	return identities;
}

function collectIrEnums(ir: AthenaSchemaIr): Map<string, SchemaEnum> {
	const map = new Map<string, SchemaEnum>();
	for (const db of ir.databases) {
		for (const item of db.enums ?? []) {
			map.set(item.id, item);
		}
		for (const ns of db.namespaces) {
			for (const item of ns.enums ?? []) {
				map.set(item.id, item);
			}
		}
	}
	return map;
}

function projectType(
	type: SchemaType,
	enums: Map<string, SchemaEnum>,
	includeEnumValues: boolean,
): V1ColumnType {
	const native = type.native;
	const projected: V1ColumnType = {
		name: native.name,
		arrayDimensions: native.arrayDimensions,
		...(native.length === undefined ? {} : { length: native.length }),
		...(native.precision === undefined ? {} : { precision: native.precision }),
		...(native.scale === undefined ? {} : { scale: native.scale }),
	};
	if (includeEnumValues && type.kind === "enum") {
		const labels = enums.get(type.enumId)?.labels;
		if (labels && labels.length > 0) {
			return { ...projected, enumValues: [...labels] };
		}
	}
	return projected;
}

function projectTable(
	table: SchemaTable,
	ir: AthenaSchemaIr,
	includeEnumValues: boolean,
): V1Table {
	const enums = collectIrEnums(ir);
	const tablesById = new Map(
		collectIrTables(ir).map((item) => [item.id as string, item]),
	);
	const schema = table.identity.physical.namespace;
	const name = table.identity.physical.name;
	const columns: V1Column[] = table.columns.map((column) => ({
		name: column.identity.physical.name,
		type: projectType(column.type, enums, includeEnumValues),
		nullable: column.nullable,
		default: column.default ?? null,
		isGenerated: column.generated === true,
	}));

	let primaryKey: V1Table["primaryKey"] = null;
	const uniqueConstraints: V1Unique[] = [];
	const foreignKeys: V1ForeignKey[] = [];

	for (const constraint of table.constraints) {
		if (constraint.kind === "primary_key") {
			primaryKey = {
				name: constraint.name ?? null,
				columns: [...constraint.columns],
			};
		} else if (constraint.kind === "unique") {
			uniqueConstraints.push({
				name: constraint.name ?? null,
				columns: [...constraint.columns],
			});
		} else if (constraint.kind === "foreign_key") {
			const target = tablesById.get(String(constraint.targetTableId));
			const targetSchema =
				target?.identity.physical.namespace ??
				String(constraint.targetTableId).split(":")[1]?.split(".")[0] ??
				schema;
			const targetName =
				target?.identity.physical.name ??
				String(constraint.targetTableId).split(".").pop() ??
				String(constraint.targetTableId);
			const targetDatabase =
				target?.identity.physical.database ??
				table.identity.physical.database;
			foreignKeys.push({
				name: constraint.name ?? null,
				columns: [...constraint.columns],
				target: {
					schema: targetSchema,
					name: targetName,
					...(targetDatabase ? { database: targetDatabase } : {}),
				},
				targetColumns: [...constraint.targetColumns],
				onDelete: constraint.onDelete ?? "no_action",
				onUpdate: constraint.onUpdate ?? "no_action",
			});
		}
	}

	const indexes: V1Index[] = table.indexes.map((ix) => ({
		name: ix.name ?? null,
		unique: ix.unique,
		predicate: ix.predicate ?? null,
		method: ix.method ?? null,
		columns: ix.columns.map((c) => ({
			name: c.name,
			direction: c.direction ?? "asc",
		})),
	}));

	const database = table.identity.physical.database;
	return {
		schema,
		name,
		...(database ? { database } : {}),
		columns,
		primaryKey,
		uniqueConstraints,
		foreignKeys,
		indexes,
	};
}

/**
 * Lossy v1 projection. CHECK / semantic relations / first-class enums may drop.
 * Must not be used as the structural SSOT.
 */
export function schemaSnapshotFromIr(ir: AthenaSchemaIr): AthenaSchemaSnapshot {
	const canonical = canonicalizeAthenaSchemaIr(ir);
	validateAthenaSchemaIr(canonical);
	const includeEnumValues =
		canonical.metadata.provenance?.source !== "models" &&
		canonical.metadata.provenance?.source !== "table";
	const backend =
		canonical.databases[0]?.backend ??
		canonical.metadata.provenance?.backend ??
		null;

	const byNamespace = new Map<
		string,
		{ database: string; name: string; tables: V1Table[] }
	>();
	for (const identity of collectIrNamespaceIdentities(canonical).values()) {
		const key = `${identity.database}\0${identity.schema}`;
		if (!byNamespace.has(key)) {
			byNamespace.set(key, {
				database: identity.database,
				name: identity.schema,
				tables: [],
			});
		}
	}
	for (const table of collectIrTables(canonical)) {
		const projected = projectTable(table, canonical, includeEnumValues);
		const database = table.identity.physical.database;
		const key = `${database}\0${projected.schema}`;
		const bucket = byNamespace.get(key) ?? {
			database,
			name: projected.schema,
			tables: [],
		};
		bucket.tables.push(projected);
		byNamespace.set(key, bucket);
	}

	const schemas = [...byNamespace.values()].map((ns) => ({
		name: ns.name,
		tables: ns.tables,
		...(ns.database ? { database: ns.database } : {}),
	}));

	return {
		version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
		backend,
		schemas,
	};
}

function semanticFromKind(kind: ModelColumnKind): string {
	switch (kind) {
		case "boolean":
			return "boolean";
		case "number":
			return "float";
		case "decimal":
			return "decimal";
		case "json":
			return "json";
		case "enumeration":
			return "enum";
		default:
			return "string";
	}
}

function sqlTypeFromKind(
	kind: ModelColumnKind,
	isSoleGeneratedPk: boolean,
	precision?: number,
	scale?: number,
): string {
	if (isSoleGeneratedPk && kind === "number") {
		return "bigint";
	}
	switch (kind) {
		case "boolean":
			return "boolean";
		case "number":
			return "double precision";
		case "decimal":
			if (typeof precision === "number" && typeof scale === "number") {
				return `numeric(${precision}, ${scale})`;
			}
			if (typeof precision === "number") {
				return `numeric(${precision})`;
			}
			return "numeric";
		case "json":
			return "jsonb";
		case "enumeration":
			return "text";
		default:
			return "text";
	}
}

function cardinalityFromKind(
	kind: ModelRelationKind,
): SchemaRelationCardinality {
	switch (kind) {
		case "one-to-one":
			return "1:1";
		case "one-to-many":
			return "1:n";
		case "many-to-many":
			return "n:n";
		default:
			return "n:1";
	}
}

function nativeFromParsed(
	parsed: V1ColumnType,
	backend: string,
): NativeTypeDescriptor {
	return nativeFromV1(parsed, backend);
}

export function schemaIrFromModels(
	models: unknown,
	options: SchemaIrFromModelsOptions = {},
): AthenaSchemaIr {
	const defaultSchema = options.defaultSchema?.trim() || DEFAULT_SCHEMA;
	const defaultDatabase = options.defaultDatabase?.trim() || DEFAULT_DATABASE;
	const backend =
		options.backend === undefined ? DEFAULT_BACKEND : options.backend;
	const resolved = collectModelsFromSqlInput(models as ModelSqlInput);

	const physicalByTableId = new Map<string, Map<string, string>>();
	for (const table of resolved) {
		const schemaName = table.schemaName?.trim() || defaultSchema;
		const databaseName =
			(table.model.meta as { database?: string }).database?.trim() ||
			defaultDatabase;
		const logicalName =
			(table.model.meta.model ?? table.tableName).trim() || table.tableName;
		physicalByTableId.set(
			tableStableId(databaseName, schemaName, logicalName),
			new Map(table.columns.map((column) => [column.logicalName, column.name])),
		);
	}

	const databases = new Map<
		string,
		Map<string, { enums: SchemaEnum[]; tables: SchemaTable[] }>
	>();

	const ensureNs = (databaseName: string, schemaName: string) => {
		let bySchema = databases.get(databaseName);
		if (!bySchema) {
			bySchema = new Map();
			databases.set(databaseName, bySchema);
		}
		let bucket = bySchema.get(schemaName);
		if (!bucket) {
			bucket = { enums: [], tables: [] };
			bySchema.set(schemaName, bucket);
		}
		return bucket;
	};

	for (const table of resolved) {
		const schemaName = table.schemaName?.trim() || defaultSchema;
		const databaseName =
			(table.model.meta as { database?: string }).database?.trim() ||
			defaultDatabase;
		const bucket = ensureNs(databaseName, schemaName);
		const logicalName =
			(table.model.meta.model ?? table.tableName).trim() || table.tableName;
		const tableId = tableStableId(databaseName, schemaName, logicalName);
		const logicalToPhysical = new Map(
			table.columns.map((column) => [column.logicalName, column.name]),
		);
		const mapPhysical = (name: string): string =>
			logicalToPhysical.get(name) ?? name;
		const soleAuthoredPk =
			table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;
		const solePk =
			soleAuthoredPk === undefined ? undefined : mapPhysical(soleAuthoredPk);
		const soleGeneratedPk =
			solePk !== undefined &&
			table.columns.some(
				(c) => c.name === solePk && c.isGenerated && c.kind === "number",
			);

		const columns: SchemaColumn[] = [];
		const constraints: SchemaConstraint[] = [];

		for (const column of table.columns) {
			const isSoleGeneratedPk = Boolean(
				soleGeneratedPk && column.name === solePk && column.kind === "number",
			);
			const sqlType = sqlTypeFromKind(
				column.kind,
				isSoleGeneratedPk,
				column.precision,
				column.scale,
			);
			const parsed = parseSchemaTypeString(sqlType, 0);
			let enumId: string | undefined;
			if (column.kind === "enumeration" && column.enumValues?.length) {
				enumId = enumStableId(
					databaseName,
					schemaName,
					logicalName,
					column.name,
				);
				bucket.enums.push({
					id: id(enumId),
					identity: schemaObjectIdentity(databaseName, schemaName, column.name),
					labels: [...column.enumValues],
				});
				const quoted = column.enumValues
					.map((v) => `'${String(v).replaceAll("'", "''")}'`)
					.join(", ");
				constraints.push({
					id: id(`cst:${tableId}:${column.name}:check`),
					kind: "check",
					expression: `${column.name} IN (${quoted})`,
				});
			}

			const native = nativeFromParsed(parsed, backend ?? DEFAULT_BACKEND);
			const type: SchemaType = enumId
				? { kind: "enum", enumId, native }
				: {
						kind: "scalar",
						semantic: isSoleGeneratedPk
							? "bigint"
							: semanticFromKind(column.kind),
						native,
					};

			let defaultExpr: string | null = null;
			let generated = column.isGenerated;
			if (isSoleGeneratedPk) {
				const seqName = `${table.tableName}_${column.name}_seq`;
				defaultExpr = `nextval('${seqName}'::regclass)`;
				generated = false;
			}

			const logicalColumnName = column.logicalName || column.name;
			columns.push({
				id: id(
					columnStableId(
						databaseName,
						schemaName,
						logicalName,
						logicalColumnName,
					),
				),
				identity: schemaObjectIdentity(
					databaseName,
					schemaName,
					logicalColumnName,
					{ name: column.name },
				),
				type,
				nullable: column.nullable,
				default: defaultExpr,
				generated,
			});
		}

		if (table.primaryKey.length > 0) {
			constraints.push({
				id: id(`cst:${tableId}:pk`),
				kind: "primary_key",
				columns: table.primaryKey.map(mapPhysical),
				name: null,
			});
		}

		const relations: SchemaRelation[] = [];
		const authoredRelations = table.model.meta.relations ?? {};
		for (const [relName, relation] of Object.entries(authoredRelations) as [
			string,
			ModelRelationMetadata,
		][]) {
			const targetId = tableStableId(
				relation.targetDatabase ?? databaseName,
				relation.targetSchema,
				relation.targetModel,
			);
			if (!physicalByTableId.has(targetId)) {
				continue;
			}
			const isFk =
				(relation.kind === "many-to-one" || relation.kind === "one-to-one") &&
				!relation.through;
			const backing: string[] = [];
			const sourcePhysical = mapAuthoredColumns(
				relation.sourceColumns,
				logicalToPhysical,
			);
			const targetPhysical = mapAuthoredColumns(
				relation.targetColumns,
				physicalByTableId.get(targetId),
			);
			if (isFk) {
				const fkId = fkStableId(
					tableId,
					sourcePhysical,
					targetId,
					targetPhysical,
				);
				backing.push(fkId);
				constraints.push({
					id: id(fkId),
					kind: "foreign_key",
					columns: sourcePhysical,
					targetTableId: targetId,
					targetColumns: targetPhysical,
					name: null,
					onDelete: "no_action",
					onUpdate: "no_action",
				});
			}
			let through: SchemaRelationThrough | undefined;
			if (relation.through) {
				const throughTableId = tableStableId(
					databaseName,
					relation.through.schema,
					relation.through.model,
				);
				if (!physicalByTableId.has(throughTableId)) {
					continue;
				}
				const throughMap = physicalByTableId.get(throughTableId);
				through = {
					tableId: throughTableId,
					sourceColumns: mapAuthoredColumns(
						relation.through.sourceColumns,
						throughMap,
					),
					targetColumns: mapAuthoredColumns(
						relation.through.targetColumns,
						throughMap,
					),
				};
			}
			relations.push({
				id: id(`rel:${tableId}:${relName}`),
				cardinality: cardinalityFromKind(relation.kind),
				sourceTableId: tableId,
				targetTableId: targetId,
				sourceColumns: sourcePhysical,
				targetColumns: targetPhysical,
				backingConstraintIds: backing,
				name: relName,
				through,
			});
		}

		bucket.tables.push({
			id: id(tableId),
			identity: schemaObjectIdentity(
				databaseName,
				schemaName,
				(table.model.meta.model ?? table.tableName).trim() || table.tableName,
				{ name: table.tableName },
			),
			columns,
			constraints,
			relations,
			indexes: [],
		});
	}

	const emittedDatabases: SchemaDatabase[] = [...databases.entries()].map(
		([databaseName, bySchema]) => ({
			id: id(`db:${databaseName}`),
			identity: schemaObjectIdentity(
				databaseName,
				DEFAULT_SCHEMA,
				databaseName,
			),
			namespaces: [...bySchema.entries()].map(([schemaName, bucket]) => ({
				id: id(`ns:${databaseName}.${schemaName}`),
				identity: schemaObjectIdentity(databaseName, schemaName, schemaName),
				enums: bucket.enums,
				tables: bucket.tables,
			})),
			backend,
		}),
	);

	return canonicalizeAthenaSchemaIr({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: emittedDatabases,
		metadata: {
			provenance: { source: "models", backend },
			extensions: {},
		},
	});
}

export function schemaIrFromTable(tableDef: unknown): AthenaSchemaIr {
	if (isObject(tableDef) && tableDef.ir != null) {
		return canonicalizeAthenaSchemaIr(tableDef.ir);
	}
	return schemaIrFromModels([tableDef], { defaultDatabase: DEFAULT_DATABASE });
}

function columnTypeFromIntrospection(
	column: IntrospectionColumn,
	backend: string,
	enumId?: string,
): SchemaType {
	const parsedUdt = parseSchemaTypeString(
		column.udtName || column.dataType,
		column.arrayDimensions ?? 0,
	);
	const formatted = parseSchemaTypeString(
		column.dataType || column.udtName,
		column.arrayDimensions ?? 0,
	);
	const name =
		parsedUdt.name.length <= formatted.name.length
			? parsedUdt.name
			: formatted.name;
	const native: NativeTypeDescriptor = {
		backend,
		name,
		arrayDimensions: formatted.arrayDimensions || parsedUdt.arrayDimensions,
		length: formatted.length ?? parsedUdt.length,
		precision: formatted.precision ?? parsedUdt.precision,
		scale: formatted.scale ?? parsedUdt.scale,
	};
	if (enumId || column.typeKind === "enum") {
		return {
			kind: "enum",
			enumId:
				enumId ??
				enumStableId("default", "_", "_", column.udtName || column.name),
			native,
		};
	}
	return { kind: "scalar", semantic: name, native };
}

function isOutboundFkRelation(relation: IntrospectionRelation): boolean {
	return relation.kind === "many-to-one" || relation.kind === "one-to-one";
}

function introspectedEnumStableId(
	database: string,
	schema: string,
	name: string,
): string {
	return `enum:${database}.${schema}.${name}`;
}

function lookupIntrospectionTable(
	snapshot: IntrospectionSnapshot,
	schema: string,
	name: string,
): IntrospectionTable | undefined {
	const ns = snapshot.schemas[schema];
	if (!ns) {
		return undefined;
	}
	const direct = ns.tables[name];
	if (direct) {
		return direct;
	}
	return Object.values(ns.tables).find((table) => table.name === name);
}

function collectIntrospectionTables(
	snapshot: IntrospectionSnapshot,
	selectedNamespaces: ReadonlySet<string>,
): Map<string, IntrospectionTable> {
	const included = new Map<string, IntrospectionTable>();
	const tableKey = (schema: string, name: string) => `${schema}\u0000${name}`;
	const includeTable = (schema: string, name: string): void => {
		const key = tableKey(schema, name);
		if (included.has(key)) {
			return;
		}
		const table = lookupIntrospectionTable(snapshot, schema, name);
		if (!table) {
			return;
		}
		included.set(key, table);
		for (const relation of Object.values(table.relations)) {
			includeTable(relation.targetSchema, relation.targetModel);
			if (relation.through) {
				includeTable(relation.through.schema, relation.through.model);
			}
		}
	};
	for (const nsName of selectedNamespaces) {
		const ns = snapshot.schemas[nsName];
		if (!ns) {
			continue;
		}
		for (const table of Object.values(ns.tables)) {
			includeTable(table.schema || nsName, table.name);
		}
	}
	return included;
}

export function schemaIrFromIntrospection(
	snapshot: IntrospectionSnapshot,
	options: SchemaIrFromIntrospectionOptions = {},
): AthenaSchemaIr {
	const excludeInternal = options.excludeInternal !== false;
	const allow = options.schemas ? new Set(options.schemas) : null;
	const databaseName = snapshot.database?.trim() || DEFAULT_DATABASE;
	const backend = snapshot.backend || DEFAULT_BACKEND;

	const selectedNamespaces = new Set<string>();
	for (const ns of Object.values(snapshot.schemas)) {
		if (allow && !allow.has(ns.name)) {
			continue;
		}
		if (excludeInternal && INTERNAL_SCHEMAS.has(ns.name)) {
			continue;
		}
		selectedNamespaces.add(ns.name);
	}
	const includedTables = collectIntrospectionTables(
		snapshot,
		selectedNamespaces,
	);

	const namespaces: SchemaNamespace[] = [];

	for (const ns of Object.values(snapshot.schemas)) {
		const schemaTables = [...includedTables.values()].filter(
			(table) => (table.schema || ns.name) === ns.name,
		);
		if (schemaTables.length === 0) {
			if (!selectedNamespaces.has(ns.name)) {
				continue;
			}
			namespaces.push({
				id: id(`ns:${databaseName}.${ns.name}`),
				identity: schemaObjectIdentity(databaseName, ns.name, ns.name),
				enums: [],
				tables: [],
			});
			continue;
		}

		const enums: SchemaEnum[] = [];
		const seenEnums = new Set<string>();
		const tables: SchemaTable[] = [];

		for (const table of schemaTables) {
			const tableId = tableStableId(databaseName, table.schema, table.name);
			const columns: SchemaColumn[] = [];
			for (const column of Object.values(table.columns)) {
				let enumId: string | undefined;
				if (column.enumValues && column.enumValues.length > 0) {
					const enumName = column.udtName || column.dataType || column.name;
					enumId = introspectedEnumStableId(
						databaseName,
						table.schema,
						enumName,
					);
					if (!seenEnums.has(enumId)) {
						seenEnums.add(enumId);
						enums.push({
							id: id(enumId),
							identity: schemaObjectIdentity(
								databaseName,
								table.schema,
								enumName,
							),
							labels: [...column.enumValues],
						});
					}
				}
				const defaultExpr =
					column.defaultExpression === undefined
						? null
						: column.defaultExpression;
				columns.push({
					id: id(
						columnStableId(databaseName, table.schema, table.name, column.name),
					),
					identity: schemaObjectIdentity(
						databaseName,
						table.schema,
						column.name,
					),
					type: columnTypeFromIntrospection(column, backend, enumId),
					nullable: column.isNullable,
					default: defaultExpr,
					generated: column.isGenerated,
				});
			}

			const constraints: SchemaConstraint[] = [];
			if (table.primaryKey.length > 0) {
				constraints.push({
					id: id(`cst:${tableId}:pk`),
					kind: "primary_key",
					columns: [...table.primaryKey],
					name: null,
				});
			}
			for (const unique of table.uniqueConstraints ?? []) {
				constraints.push({
					id: id(`cst:${tableId}:uq:${unique.columns.join(",")}`),
					kind: "unique",
					columns: [...unique.columns],
					name: unique.name ?? null,
				});
			}

			const relations: SchemaRelation[] = [];
			const seenFk = new Set<string>();
			for (const [relName, relation] of Object.entries(table.relations)) {
				const targetId = tableStableId(
					relation.targetDatabase ?? databaseName,
					relation.targetSchema,
					relation.targetModel,
				);
				if (
					!includedTables.has(
						`${relation.targetSchema}\u0000${relation.targetModel}`,
					)
				) {
					continue;
				}
				if (relation.through) {
					const throughKey = `${relation.through.schema}\u0000${relation.through.model}`;
					if (!includedTables.has(throughKey)) {
						continue;
					}
				}
				const backing: string[] = [];
				if (isOutboundFkRelation(relation) && !relation.through) {
					const key = [
						relation.sourceColumns.join(","),
						relation.targetSchema,
						relation.targetModel,
						relation.targetColumns.join(","),
					].join("\0");
					if (!seenFk.has(key)) {
						seenFk.add(key);
						const fkId = fkStableId(
							tableId,
							relation.sourceColumns,
							targetId,
							relation.targetColumns,
						);
						backing.push(fkId);
						constraints.push({
							id: id(fkId),
							kind: "foreign_key",
							columns: [...relation.sourceColumns],
							targetTableId: targetId,
							targetColumns: [...relation.targetColumns],
							name: relation.name ?? null,
							onDelete: normalizeReferentialAction(
								relation.onDelete,
							) as SchemaReferentialAction,
							onUpdate: normalizeReferentialAction(
								relation.onUpdate,
							) as SchemaReferentialAction,
						});
					}
				}
				relations.push({
					id: id(`rel:${tableId}:${relName}`),
					cardinality: cardinalityFromKind(relation.kind),
					sourceTableId: tableId,
					targetTableId: targetId,
					sourceColumns: [...relation.sourceColumns],
					targetColumns: [...relation.targetColumns],
					backingConstraintIds: backing,
					name: relation.name ?? relName,
					...(relation.through
						? {
								through: {
									tableId: tableStableId(
										databaseName,
										relation.through.schema,
										relation.through.model,
									),
									sourceColumns: [...relation.through.sourceColumns],
									targetColumns: [...relation.through.targetColumns],
								},
							}
						: {}),
				});
			}

			const indexes: SchemaIndex[] = (table.indexes ?? []).map((ix, index) => {
				const directions = ix.columnDirections ?? [];
				return {
					id: id(`idx:${tableId}:${ix.name ?? index}`),
					unique: Boolean(ix.unique),
					name: ix.name ?? null,
					predicate: ix.predicate ?? null,
					method: ix.method ?? null,
					columns: ix.columns.map((colName, i) => ({
						name: colName,
						direction:
							directions[i] === "desc" ? ("desc" as const) : ("asc" as const),
					})),
				};
			});

			tables.push({
				id: id(tableId),
				identity: schemaObjectIdentity(databaseName, table.schema, table.name),
				columns,
				constraints,
				relations,
				indexes,
			});
		}

		namespaces.push({
			id: id(`ns:${databaseName}.${ns.name}`),
			identity: schemaObjectIdentity(databaseName, ns.name, ns.name),
			enums,
			tables,
		});
	}

	return canonicalizeAthenaSchemaIr({
		kind: ATHENA_SCHEMA_IR_KIND,
		irVersion: ATHENA_SCHEMA_IR_VERSION,
		databases: [
			{
				id: id(`db:${databaseName}`),
				identity: schemaObjectIdentity(
					databaseName,
					DEFAULT_SCHEMA,
					databaseName,
				),
				namespaces,
				backend,
			},
		],
		metadata: {
			provenance: {
				source: "introspection",
				generatedAt: snapshot.generatedAt,
				backend,
			},
			extensions: {},
		},
	});
}

function irDatabaseNames(ir: AthenaSchemaIr): string[] {
	const names = new Set<string>();
	for (const db of ir.databases) {
		names.add(db.identity.physical.database || DEFAULT_DATABASE);
	}
	return [...names];
}

function rewriteIrDatabaseName(
	ir: AthenaSchemaIr,
	from: string,
	to: string,
): AthenaSchemaIr {
	if (from === to) {
		return ir;
	}
	const rewritten: unknown = JSON.parse(JSON.stringify(ir), (key, value) => {
		if (key === "database" && value === from) {
			return to;
		}
		if (typeof value !== "string") {
			return value;
		}
		if (value === `db:${from}`) {
			return `db:${to}`;
		}
		if (
			key === "id" ||
			key === "enumId" ||
			key === "targetTableId" ||
			key.endsWith("Id")
		) {
			return value.replaceAll(`:${from}.`, `:${to}.`).replaceAll(
				`db:${from}`,
				`db:${to}`,
			);
		}
		return value;
	});
	return rewritten as AthenaSchemaIr;
}

/**
 * Authored models omit a catalog name and lift as `default`. A live
 * introspection snapshot names that same catalog. When each document has
 * exactly one database and one side is `default`, treat them as the same
 * catalog so serial/enum models do not drop+create against the live DB.
 * Distinct named catalogs (multi-tenant) are left alone.
 */
export function alignSingletonDefaultDatabase(
	from: AthenaSchemaIr,
	to: AthenaSchemaIr,
): { from: AthenaSchemaIr; to: AthenaSchemaIr } {
	const fromNames = irDatabaseNames(from);
	const toNames = irDatabaseNames(to);
	if (fromNames.length !== 1 || toNames.length !== 1) {
		return { from, to };
	}
	const fromDb = fromNames[0];
	const toDb = toNames[0];
	if (!fromDb || !toDb || fromDb === toDb) {
		return { from, to };
	}
	if (toDb === DEFAULT_DATABASE) {
		return { from, to: rewriteIrDatabaseName(to, DEFAULT_DATABASE, fromDb) };
	}
	if (fromDb === DEFAULT_DATABASE) {
		return { from: rewriteIrDatabaseName(from, DEFAULT_DATABASE, toDb), to };
	}
	return { from, to };
}

export {
	collectIrNamespaceIdentities,
	collectIrNamespaceNames,
	collectIrTables,
	projectTable,
};
