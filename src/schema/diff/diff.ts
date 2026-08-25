import { canonicalizeAthenaSchemaIr } from "../ir/canonicalize.ts";
import {
	alignSingletonDefaultDatabase,
	collectIrNamespaceIdentities,
	collectIrTables,
	isAthenaSchemaIr,
	projectTable,
	schemaIrFromSnapshot,
	schemaSnapshotFromIr,
} from "../ir/compatibility.ts";
import type { AthenaSchemaIr } from "../ir/document.ts";
import { physicalIdentityKey } from "../ir/identity.ts";
import type { SchemaTable as IrSchemaTable } from "../ir/table.ts";
import { SchemaIrError, validateAthenaSchemaIr } from "../ir/validate.ts";
import {
	foreignKeyMatchKey,
	indexStructuralKey,
	uniqueStructuralKey,
} from "./identity.ts";
import {
	columnsEqual,
	columnTypesEqual,
	normalizeSchemaSnapshot,
	primaryKeysEqual,
} from "./normalize.ts";
import { summarizeSchemaDiffOperations } from "./summary.ts";
import type {
	AthenaSchemaSnapshot,
	DiffSchemasInput,
	DiffSchemasOptions,
	SchemaColumn,
	SchemaDiff,
	SchemaDiffOperation,
	SchemaForeignKey,
	SchemaIndex,
	SchemaTable,
	SchemaTableIdentity,
	SchemaUniqueConstraint,
} from "./types.ts";
import { validateSchemaSnapshot } from "./validate.ts";

const OPERATION_KIND_ORDER: Readonly<
	Record<SchemaDiffOperation["kind"], number>
> = {
	create_schema: 4,
	rename_table: 5,
	drop_foreign_key: 10,
	drop_index: 20,
	drop_unique_constraint: 30,
	drop_primary_key: 40,
	drop_column: 50,
	drop_table: 60,
	drop_schema: 70,
	create_table: 90,
	rename_column: 100,
	add_column: 110,
	alter_column: 130,
	add_primary_key: 140,
	add_unique_constraint: 150,
	add_index: 160,
	add_foreign_key: 170,
	alter_foreign_key: 180,
};

function tableId(table: SchemaTable): SchemaTableIdentity {
	const database = table.database?.trim();
	return {
		schema: table.schema,
		name: table.name,
		...(database ? { database } : {}),
	};
}

function operationSortKey(op: SchemaDiffOperation): string {
	const kindOrder = String(OPERATION_KIND_ORDER[op.kind]).padStart(3, "0");
	switch (op.kind) {
		case "create_schema":
		case "drop_schema":
			return `${kindOrder}\u0000${op.database ?? ""}\u0000${op.schema}`;
		case "create_table":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}`;
		case "drop_table":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}`;
		case "rename_table":
			return `${kindOrder}\u0000${op.from.schema}\u0000${op.from.name}\u0000${op.to.name}`;
		case "add_column":
		case "drop_column":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.column.name}`;
		case "rename_column":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}`;
		case "alter_column":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.column}`;
		case "add_primary_key":
		case "drop_primary_key":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.primaryKey.columns.join(",")}`;
		case "add_unique_constraint":
		case "drop_unique_constraint":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${op.unique.columns.join(",")}`;
		case "add_foreign_key":
		case "drop_foreign_key":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${foreignKeyMatchKey(op.foreignKey)}`;
		case "alter_foreign_key":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${foreignKeyMatchKey(op.before)}`;
		case "add_index":
		case "drop_index":
			return `${kindOrder}\u0000${op.table.schema}\u0000${op.table.name}\u0000${indexStructuralKey(op.index)}`;
		default: {
			const _never: never = op;
			return kindOrder + String(_never);
		}
	}
}

function sortOperations(
	operations: SchemaDiffOperation[],
): SchemaDiffOperation[] {
	return operations
		.map((op, index) => ({ index, op }))
		.sort((a, b) => {
			const ka = operationSortKey(a.op);
			const kb = operationSortKey(b.op);
			if (ka < kb) {
				return -1;
			}
			if (ka > kb) {
				return 1;
			}
			return a.index - b.index;
		})
		.map((item) => item.op);
}

function indexColumns(table: SchemaTable): Map<string, SchemaColumn> {
	const map = new Map<string, SchemaColumn>();
	for (const column of table.columns) {
		map.set(column.name, column);
	}
	return map;
}

function indexUniques(table: SchemaTable): Map<string, SchemaUniqueConstraint> {
	const map = new Map<string, SchemaUniqueConstraint>();
	for (const unique of table.uniqueConstraints) {
		map.set(uniqueStructuralKey(unique), unique);
	}
	return map;
}

function indexForeignKeys(table: SchemaTable): Map<string, SchemaForeignKey> {
	const map = new Map<string, SchemaForeignKey>();
	for (const fk of table.foreignKeys) {
		map.set(foreignKeyMatchKey(fk), fk);
	}
	return map;
}

function indexIndexes(table: SchemaTable): Map<string, SchemaIndex> {
	const map = new Map<string, SchemaIndex>();
	for (const index of table.indexes) {
		map.set(indexStructuralKey(index), index);
	}
	return map;
}

function diffColumns(
	fromTable: SchemaTable,
	toTable: SchemaTable,
	ops: SchemaDiffOperation[],
): void {
	const identity = tableId(toTable);
	const fromCols = indexColumns(fromTable);
	const toCols = indexColumns(toTable);

	for (const [name, fromCol] of fromCols) {
		if (!toCols.has(name)) {
			ops.push({
				kind: "drop_column",
				table: identity,
				column: fromCol,
			});
		}
	}

	for (const [name, toCol] of toCols) {
		const fromCol = fromCols.get(name);
		if (!fromCol) {
			ops.push({
				kind: "add_column",
				table: identity,
				column: toCol,
			});
			continue;
		}
		if (columnsEqual(fromCol, toCol)) {
			continue;
		}

		const changes: {
			type?: { from: SchemaColumn["type"]; to: SchemaColumn["type"] };
			nullable?: { from: boolean; to: boolean };
			default?: { from: string | null; to: string | null };
			isGenerated?: { from: boolean; to: boolean };
		} = {};

		// Include enumValues (and all other type fields) so enum-label-only
		// changes populate the explicit `changes.type` delta for planners.
		if (!columnTypesEqual(fromCol.type, toCol.type)) {
			changes.type = { from: fromCol.type, to: toCol.type };
		}
		if (fromCol.nullable !== toCol.nullable) {
			changes.nullable = { from: fromCol.nullable, to: toCol.nullable };
		}
		if (fromCol.default !== toCol.default) {
			changes.default = { from: fromCol.default, to: toCol.default };
		}
		if (fromCol.isGenerated !== toCol.isGenerated) {
			changes.isGenerated = {
				from: fromCol.isGenerated,
				to: toCol.isGenerated,
			};
		}

		ops.push({
			kind: "alter_column",
			table: identity,
			column: name,
			before: fromCol,
			after: toCol,
			changes,
		});
	}
}

function diffPrimaryKey(
	fromTable: SchemaTable,
	toTable: SchemaTable,
	ops: SchemaDiffOperation[],
): void {
	const identity = tableId(toTable);
	if (primaryKeysEqual(fromTable.primaryKey, toTable.primaryKey)) {
		return;
	}
	if (fromTable.primaryKey) {
		ops.push({
			kind: "drop_primary_key",
			table: identity,
			primaryKey: fromTable.primaryKey,
		});
	}
	if (toTable.primaryKey) {
		ops.push({
			kind: "add_primary_key",
			table: identity,
			primaryKey: toTable.primaryKey,
		});
	}
}

function diffUniques(
	fromTable: SchemaTable,
	toTable: SchemaTable,
	ops: SchemaDiffOperation[],
): void {
	const identity = tableId(toTable);
	const fromMap = indexUniques(fromTable);
	const toMap = indexUniques(toTable);

	for (const [key, unique] of fromMap) {
		if (!toMap.has(key)) {
			ops.push({
				kind: "drop_unique_constraint",
				table: identity,
				unique,
			});
		}
	}
	for (const [key, unique] of toMap) {
		if (!fromMap.has(key)) {
			ops.push({
				kind: "add_unique_constraint",
				table: identity,
				unique,
			});
		}
	}
}

function foreignKeysEqual(a: SchemaForeignKey, b: SchemaForeignKey): boolean {
	return (
		foreignKeyMatchKey(a) === foreignKeyMatchKey(b) &&
		a.onDelete === b.onDelete &&
		a.onUpdate === b.onUpdate
	);
}

function diffForeignKeys(
	fromTable: SchemaTable,
	toTable: SchemaTable,
	ops: SchemaDiffOperation[],
): void {
	const identity = tableId(toTable);
	const fromMap = indexForeignKeys(fromTable);
	const toMap = indexForeignKeys(toTable);

	for (const [key, fromFk] of fromMap) {
		const toFk = toMap.get(key);
		if (!toFk) {
			ops.push({
				kind: "drop_foreign_key",
				table: identity,
				foreignKey: fromFk,
			});
			continue;
		}
		if (!foreignKeysEqual(fromFk, toFk)) {
			ops.push({
				kind: "alter_foreign_key",
				table: identity,
				before: fromFk,
				after: toFk,
			});
		}
	}

	for (const [key, toFk] of toMap) {
		if (!fromMap.has(key)) {
			ops.push({
				kind: "add_foreign_key",
				table: identity,
				foreignKey: toFk,
			});
		}
	}
}

function diffIndexes(
	fromTable: SchemaTable,
	toTable: SchemaTable,
	ops: SchemaDiffOperation[],
): void {
	const identity = tableId(toTable);
	const fromMap = indexIndexes(fromTable);
	const toMap = indexIndexes(toTable);

	for (const [key, index] of fromMap) {
		if (!toMap.has(key)) {
			ops.push({
				kind: "drop_index",
				table: identity,
				index,
			});
		}
	}
	for (const [key, index] of toMap) {
		if (!fromMap.has(key)) {
			ops.push({
				kind: "add_index",
				table: identity,
				index,
			});
		}
	}
}

function rewriteColumnName(
	name: string,
	renameMap: Map<string, string>,
): string {
	return renameMap.get(name) ?? name;
}

function alignProjectedTableAfterColumnRenames(
	table: SchemaTable,
	renameMap: Map<string, string>,
	droppedNames: Set<string>,
): SchemaTable {
	if (renameMap.size === 0 && droppedNames.size === 0) {
		return table;
	}
	return {
		...table,
		columns: table.columns
			.filter((column) => !droppedNames.has(column.name))
			.map((column) => ({
				...column,
				name: rewriteColumnName(column.name, renameMap),
			})),
		primaryKey: table.primaryKey
			? {
					...table.primaryKey,
					columns: table.primaryKey.columns.map((name) =>
						rewriteColumnName(name, renameMap),
					),
				}
			: table.primaryKey,
		uniqueConstraints: table.uniqueConstraints.map((unique) => ({
			...unique,
			columns: unique.columns.map((name) => rewriteColumnName(name, renameMap)),
		})),
		foreignKeys: table.foreignKeys.map((fk) => ({
			...fk,
			columns: fk.columns.map((name) => rewriteColumnName(name, renameMap)),
		})),
		indexes: table.indexes.map((index) => ({
			...index,
			columns: index.columns.map((column) => ({
				...column,
				name: rewriteColumnName(column.name, renameMap),
			})),
		})),
	};
}

function tableIdentityKey(identity: SchemaTableIdentity): string {
	return `${identity.database ?? ""}\u0000${identity.schema}\u0000${identity.name}`;
}

function relationNameKey(
	table: SchemaTableIdentity,
	name: string,
): string {
	return `${table.database ?? ""}\u0000${table.schema}\u0000${name}`;
}

function droppedRelationNameKey(op: SchemaDiffOperation): string | null {
	let name: string | null | undefined;
	switch (op.kind) {
		case "drop_index":
			name = op.index.name;
			break;
		case "drop_unique_constraint":
			name = op.unique.name;
			break;
		case "drop_primary_key":
			name = op.primaryKey.name;
			break;
		default:
			return null;
	}
	if (typeof name !== "string" || name.length === 0) {
		return null;
	}
	return relationNameKey(op.table, name);
}

function droppedRelationTableKey(op: SchemaDiffOperation): string | null {
	switch (op.kind) {
		case "drop_index":
		case "drop_unique_constraint":
		case "drop_primary_key":
			return tableIdentityKey(op.table);
		default:
			return null;
	}
}

function relationNameFromDroppedTable(
	table: SchemaTableIdentity,
	name: string | null | undefined,
): string | null {
	if (typeof name !== "string" || name.length === 0) {
		return null;
	}
	return relationNameKey(table, name);
}

function relationNamesOwnedByDroppedTable(op: SchemaDiffOperation): string[] {
	if (op.kind !== "drop_table" || !op.previous) {
		return [];
	}
	const names: string[] = [];
	const add = (name: string | null | undefined) => {
		const key = relationNameFromDroppedTable(op.table, name);
		if (key !== null) {
			names.push(key);
		}
	};
	add(op.previous.primaryKey?.name);
	for (const unique of op.previous.uniqueConstraints) {
		add(unique.name);
	}
	for (const index of op.previous.indexes) {
		add(index.name);
	}
	return names;
}

function unusedTableName(
	identity: SchemaTableIdentity,
	reserved: Set<string>,
): string {
	const safeFrom = identity.name.replace(/[^A-Za-z0-9_]/g, "_");
	let name = `__athena_rename_${safeFrom}`;
	let n = 2;
	while (reserved.has(tableIdentityKey({ ...identity, name }))) {
		name = `__athena_rename_${safeFrom}_${n}`;
		n += 1;
	}
	reserved.add(tableIdentityKey({ ...identity, name }));
	return name;
}

function isDependencyRemovalForDroppedTable(
	op: SchemaDiffOperation,
	dest: string,
): boolean {
	return (
		op.kind === "drop_foreign_key" &&
		tableIdentityKey(op.foreignKey.target) === dest
	);
}

function extractPendingMatching(
	pending: SchemaDiffOperation[],
	predicate: (op: SchemaDiffOperation) => boolean,
): SchemaDiffOperation[] {
	const extracted: SchemaDiffOperation[] = [];
	const kept: SchemaDiffOperation[] = [];
	for (const op of pending) {
		if (predicate(op)) {
			extracted.push(op);
		} else {
			kept.push(op);
		}
	}
	pending.length = 0;
	pending.push(...kept);
	return extracted;
}

function applyTableIdentityScheduling(
	ops: SchemaDiffOperation[],
): SchemaDiffOperation[] {
	const occupied = new Set<string>();
	const reserved = new Set<string>();
	for (const op of ops) {
		if (op.kind === "drop_table") {
			occupied.add(tableIdentityKey(op.table));
			reserved.add(tableIdentityKey(op.table));
			for (const relation of relationNamesOwnedByDroppedTable(op)) {
				occupied.add(relation);
				reserved.add(relation);
			}
		}
		if (op.kind === "rename_table") {
			occupied.add(tableIdentityKey(op.from));
			reserved.add(tableIdentityKey(op.from));
			reserved.add(tableIdentityKey(op.to));
		}
		if (op.kind === "create_table") {
			reserved.add(tableIdentityKey(tableId(op.table)));
		}
		const droppedRelation = droppedRelationNameKey(op);
		const dropTableKey = droppedRelationTableKey(op);
		if (droppedRelation !== null && dropTableKey !== null) {
			reserved.add(droppedRelation);
			if (dropTableKey !== droppedRelation) {
				occupied.add(droppedRelation);
			}
		}
	}

	const pending = [...ops];
	const out: SchemaDiffOperation[] = [];
	while (pending.length > 0) {
		const op = pending[0];
		if (op === undefined) {
			break;
		}
		if (op.kind === "rename_table") {
			const dest = tableIdentityKey(op.to);
			if (occupied.has(dest)) {
				const dropIdx = pending.findIndex(
					(candidate) =>
						candidate.kind === "drop_table" &&
						(tableIdentityKey(candidate.table) === dest ||
							relationNamesOwnedByDroppedTable(candidate).includes(dest)),
				);
				if (dropIdx >= 0) {
					const drop = pending.splice(dropIdx, 1)[0];
					if (drop?.kind === "drop_table") {
						const removals = extractPendingMatching(pending, (candidate) =>
							isDependencyRemovalForDroppedTable(candidate, dest),
						);
						out.push(...removals, drop);
						occupied.delete(dest);
						occupied.delete(tableIdentityKey(drop.table));
						for (const relation of relationNamesOwnedByDroppedTable(drop)) {
							occupied.delete(relation);
						}
					}
					continue;
				}
				const dropRelationIdx = pending.findIndex((candidate) => {
					const key = droppedRelationNameKey(candidate);
					return (
						key === dest && droppedRelationTableKey(candidate) !== dest
					);
				});
				if (dropRelationIdx >= 0) {
					const dropRelation = pending.splice(dropRelationIdx, 1)[0];
					if (dropRelation !== undefined) {
						out.push(dropRelation);
						occupied.delete(dest);
					}
					continue;
				}
				const occupantIdx = pending.findIndex((candidate, index) => {
					if (index === 0 || candidate.kind !== "rename_table") {
						return false;
					}
					return (
						tableIdentityKey(candidate.from) === dest &&
						!occupied.has(tableIdentityKey(candidate.to))
					);
				});
				if (occupantIdx > 0) {
					const [occupant] = pending.splice(occupantIdx, 1);
					if (occupant) {
						pending.unshift(occupant);
					}
					continue;
				}
				const tempName = unusedTableName(op.from, reserved);
				const tempIdentity: SchemaTableIdentity = {
					name: tempName,
					schema: op.from.schema,
				};
				out.push({
					kind: "rename_table",
					from: op.from,
					to: tempIdentity,
				});
				occupied.delete(tableIdentityKey(op.from));
				occupied.add(tableIdentityKey(tempIdentity));
				pending[0] = {
					kind: "rename_table",
					from: tempIdentity,
					to: op.to,
				};
				continue;
			}
			pending.shift();
			out.push(op);
			occupied.delete(tableIdentityKey(op.from));
			occupied.add(dest);
			continue;
		}
		pending.shift();
		if (op.kind === "drop_table") {
			occupied.delete(tableIdentityKey(op.table));
			for (const relation of relationNamesOwnedByDroppedTable(op)) {
				occupied.delete(relation);
			}
		}
		const droppedRelation = droppedRelationNameKey(op);
		if (droppedRelation !== null) {
			occupied.delete(droppedRelation);
		}
		if (op.kind === "create_table") {
			occupied.add(tableIdentityKey(tableId(op.table)));
		}
		out.push(op);
	}
	return out;
}

function unusedPhysicalName(base: string, reserved: Set<string>): string {
	let name = base;
	let n = 2;
	while (reserved.has(name)) {
		name = `${base}_${n}`;
		n += 1;
	}
	reserved.add(name);
	return name;
}

function linearizeColumnRenames(
	renames: Array<{ from: string; to: string }>,
	occupied: Set<string>,
	reservedNames: Set<string>,
): Array<{ from: string; to: string }> {
	const remaining = new Map<string, string>();
	for (const rename of renames) {
		if (rename.from !== rename.to) {
			remaining.set(rename.from, rename.to);
		}
	}
	const reserved = new Set(reservedNames);
	for (const to of remaining.values()) {
		reserved.add(to);
	}

	const seen = new Set<string>();
	for (const start of remaining.keys()) {
		if (seen.has(start)) {
			continue;
		}
		const stack: string[] = [];
		const onStack = new Set<string>();
		let node: string | undefined = start;
		while (node !== undefined && remaining.has(node)) {
			if (onStack.has(node)) {
				const dest = remaining.get(node);
				if (dest === undefined) {
					break;
				}
				const safeFrom = node.replace(/[^A-Za-z0-9_]/g, "_");
				const temp = unusedPhysicalName(`__athena_rename_${safeFrom}`, reserved);
				remaining.set(node, temp);
				remaining.set(temp, dest);
				break;
			}
			if (seen.has(node)) {
				break;
			}
			onStack.add(node);
			stack.push(node);
			node = remaining.get(node);
		}
		for (const item of stack) {
			seen.add(item);
		}
	}

	const live = new Set(occupied);
	const ordered: Array<{ from: string; to: string }> = [];
	const pending = [...remaining.entries()].map(([from, to]) => ({ from, to }));
	while (pending.length > 0) {
		const idx = pending.findIndex((item) => !live.has(item.to));
		if (idx < 0) {
			throw new SchemaIrError(
				"Column rename cycle could not be linearized",
			);
		}
		const item = pending.splice(idx, 1)[0];
		if (!item) {
			break;
		}
		ordered.push(item);
		live.delete(item.from);
		live.add(item.to);
	}
	return ordered;
}

function emitColumnRenamesByIrId(
	fromIrTable: IrSchemaTable,
	toIrTable: IrSchemaTable,
	fromProjected: SchemaTable,
	tableIdentity: SchemaTableIdentity,
	ops: SchemaDiffOperation[],
): { droppedNames: Set<string>; renameMap: Map<string, string> } {
	const toById = new Map(
		toIrTable.columns.map((column) => [String(column.id), column]),
	);
	const fromProjectedByName = indexColumns(fromProjected);
	const planned: Array<{ from: string; to: string }> = [];
	const renameMap = new Map<string, string>();
	const occupied = new Set<string>();
	const reserved = new Set<string>();
	const droppedNames = new Set<string>();
	for (const fromCol of fromIrTable.columns) {
		const fromName = fromCol.identity.physical.name;
		reserved.add(fromName);
		const toCol = toById.get(String(fromCol.id));
		if (!toCol) {
			droppedNames.add(fromName);
			const column = fromProjectedByName.get(fromName);
			if (column) {
				ops.push({
					kind: "drop_column",
					table: tableIdentity,
					column,
				});
			}
			continue;
		}
		occupied.add(fromName);
		const toName = toCol.identity.physical.name;
		if (fromName === toName) {
			continue;
		}
		renameMap.set(fromName, toName);
		planned.push({ from: fromName, to: toName });
	}
	for (const toCol of toIrTable.columns) {
		reserved.add(toCol.identity.physical.name);
	}
	for (const rename of linearizeColumnRenames(planned, occupied, reserved)) {
		ops.push({
			kind: "rename_column",
			table: tableIdentity,
			from: rename.from,
			to: rename.to,
		});
	}
	return { droppedNames, renameMap };
}

function diffTable(
	fromTable: SchemaTable,
	toTable: SchemaTable,
	ops: SchemaDiffOperation[],
): void {
	diffColumns(fromTable, toTable, ops);
	diffPrimaryKey(fromTable, toTable, ops);
	diffUniques(fromTable, toTable, ops);
	diffForeignKeys(fromTable, toTable, ops);
	diffIndexes(fromTable, toTable, ops);
}

function liftToIr(
	value: AthenaSchemaSnapshot | AthenaSchemaIr,
	shouldValidate: boolean,
): AthenaSchemaIr {
	if (isAthenaSchemaIr(value)) {
		const canonical = canonicalizeAthenaSchemaIr(value);
		if (shouldValidate) {
			validateAthenaSchemaIr(canonical);
		}
		return canonical;
	}
	const normalized = normalizeSchemaSnapshot(value);
	if (shouldValidate) {
		validateSchemaSnapshot(normalized);
	}
	return schemaIrFromSnapshot(normalized);
}

function normalizeProjectedTable(
	table: SchemaTable,
	backend: string | null | undefined,
): SchemaTable {
	const snapshot = normalizeSchemaSnapshot({
		version: 1,
		backend: backend ?? null,
		schemas: [{ name: table.schema, tables: [table] }],
	});
	return snapshot.schemas[0]?.tables[0] ?? table;
}

/**
 * Compare two schema documents.
 *
 * Direction: operations transform `from` (actual) → `to` (desired).
 * Consumes AthenaSchemaIr; v1 snapshots are lifted at this boundary.
 * Same SchemaObjectId + changed physical name is `rename_table`.
 */
export function diffSchemas(
	input: DiffSchemasInput,
	options: DiffSchemasOptions = {},
): SchemaDiff {
	const shouldValidate = options.validate !== false;
	const lifted = alignSingletonDefaultDatabase(
		liftToIr(input.from, shouldValidate),
		liftToIr(input.to, shouldValidate),
	);
	const fromIr = lifted.from;
	const toIr = lifted.to;

	const fromProjected = normalizeSchemaSnapshot(schemaSnapshotFromIr(fromIr));
	const toProjected = normalizeSchemaSnapshot(schemaSnapshotFromIr(toIr));
	const backend = toProjected.backend ?? fromProjected.backend;

	const ops: SchemaDiffOperation[] = [];
	const fromIrTables = collectIrTables(fromIr);
	const toIrTables = collectIrTables(toIr);
	const fromById = new Map(
		fromIrTables.map((table) => [String(table.id), table]),
	);
	const toById = new Map(toIrTables.map((table) => [String(table.id), table]));

	const fromSchemas = collectIrNamespaceIdentities(fromIr);
	const toSchemas = collectIrNamespaceIdentities(toIr);

	for (const [key, identity] of fromSchemas) {
		if (!toSchemas.has(key)) {
			ops.push({
				kind: "drop_schema",
				schema: identity.schema,
				...(identity.database ? { database: identity.database } : {}),
			});
		}
	}
	for (const [key, identity] of toSchemas) {
		if (!fromSchemas.has(key)) {
			ops.push({
				kind: "create_schema",
				schema: identity.schema,
				...(identity.database ? { database: identity.database } : {}),
			});
		}
	}

	const pairedToIds = new Set<string>();
	const pairs: Array<{
		fromTable: IrSchemaTable;
		toTable: IrSchemaTable;
	}> = [];

	for (const [tableObjectId, fromTable] of fromById) {
		const toTable = toById.get(tableObjectId);
		if (toTable) {
			pairs.push({ fromTable, toTable });
			pairedToIds.add(tableObjectId);
		}
	}

	const unmatchedFrom = [...fromById.entries()].filter(
		([id]) => !toById.has(id),
	);
	const unmatchedTo = [...toById.entries()].filter(
		([id]) => !pairedToIds.has(id),
	);
	const toByPhysical = new Map<string, IrSchemaTable[]>();
	for (const [, table] of unmatchedTo) {
		const key = physicalIdentityKey(table.identity);
		const list = toByPhysical.get(key) ?? [];
		list.push(table);
		toByPhysical.set(key, list);
	}

	const physicallyPairedFrom = new Set<string>();
	for (const [fromId, fromTable] of unmatchedFrom) {
		const candidates = toByPhysical.get(
			physicalIdentityKey(fromTable.identity),
		);
		const toTable = candidates?.shift();
		if (toTable) {
			pairs.push({ fromTable, toTable });
			physicallyPairedFrom.add(fromId);
			pairedToIds.add(String(toTable.id));
		}
	}

	for (const [fromId, fromTable] of unmatchedFrom) {
		if (physicallyPairedFrom.has(fromId)) {
			continue;
		}
		const projected = normalizeProjectedTable(
			projectTable(fromTable, fromIr, true),
			backend,
		);
		ops.push({
			kind: "drop_table",
			table: tableId(projected),
			previous: projected,
		});
	}

	for (const [tableObjectId, toTable] of toById) {
		if (pairedToIds.has(tableObjectId)) {
			continue;
		}
		const toProjectedTable = normalizeProjectedTable(
			projectTable(toTable, toIr, true),
			backend,
		);
		ops.push({
			kind: "create_table",
			table: toProjectedTable,
		});
	}

	for (const { fromTable, toTable } of pairs) {
		const toProjectedTable = normalizeProjectedTable(
			projectTable(toTable, toIr, true),
			backend,
		);
		const fromProjectedTable = normalizeProjectedTable(
			projectTable(fromTable, fromIr, true),
			backend,
		);
		const fromIdentity = tableId(fromProjectedTable);
		const toIdentity = tableId(toProjectedTable);
		const fromDatabase = fromTable.identity.physical.database;
		const toDatabase = toTable.identity.physical.database;
		if (fromDatabase !== toDatabase) {
			throw new SchemaIrError(
				`Cross-database table moves are unsupported (${fromDatabase} → ${toDatabase})`,
			);
		}
		if (
			fromIdentity.schema !== toIdentity.schema ||
			fromIdentity.name !== toIdentity.name
		) {
			ops.push({
				kind: "rename_table",
				from: fromIdentity,
				to: toIdentity,
			});
		}
		const { droppedNames, renameMap: columnRenames } =
			emitColumnRenamesByIrId(
				fromTable,
				toTable,
				fromProjectedTable,
				toIdentity,
				ops,
			);
		const fromAligned = alignProjectedTableAfterColumnRenames(
			fromProjectedTable,
			columnRenames,
			droppedNames,
		);
		diffTable(fromAligned, toProjectedTable, ops);
	}

	const operations = expandDroppedTableColumns(
		applyTableIdentityScheduling(sortOperations(ops)),
	);
	const summary = summarizeSchemaDiffOperations(operations);
	return {
		operations,
		summary,
		isEmpty: operations.length === 0,
	};
}

function expandDroppedTableColumns(
	operations: SchemaDiffOperation[],
): SchemaDiffOperation[] {
	const extra: SchemaDiffOperation[] = [];
	const seen = new Set<string>();
	for (const op of operations) {
		if (op.kind === "drop_column") {
			seen.add(`${tableIdentityKey(op.table)}.${op.column.name}`);
		}
	}
	for (const op of operations) {
		if (op.kind !== "drop_table" || !op.previous) {
			continue;
		}
		for (const column of op.previous.columns) {
			const key = `${tableIdentityKey(op.table)}.${column.name}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			extra.push({
				column,
				kind: "drop_column",
				table: op.table,
			});
		}
	}
	return extra.length === 0 ? operations : [...operations, ...extra];
}

/** Convenience: true when normalized snapshots are equivalent. */
export function isSchemaDiffEmpty(diff: SchemaDiff): boolean {
	return diff.isEmpty;
}

/**
 * Build an empty Athena schema snapshot (useful for tests / baselines).
 */
export function emptySchemaSnapshot(
	backend: string | null = null,
): AthenaSchemaSnapshot {
	return normalizeSchemaSnapshot({
		version: 1,
		backend,
		schemas: [],
	});
}
