/**
 * Portable Athena read-query definition and executor.
 *
 * Runs findMany / select page queries against `createClient(...).db` with
 * expression columns, display aliases, filters, order, and total-count handling.
 * UI hooks (pagination, dataProxy, TanStack) live in consumer packages such as
 * athena-auth-ui — this module is the SDK contract only.
 */

import {
	type AthenaQueryDebugAst,
	getAthenaDebugAst,
} from "../query-debug-ast.ts";
import type { AthenaClient } from "../v3-client-core.ts";

export type AthenaReadQueryMode = "findMany" | "select";

export type AthenaReadQueryFilterOperator =
	| "eq"
	| "gt"
	| "gte"
	| "ilike"
	| "in"
	| "is"
	| "like"
	| "lt"
	| "lte"
	| "neq";

export type AthenaReadQueryOrderDirection = "asc" | "desc";

export interface AthenaReadQueryRelationRef {
	name: string;
	schema?: string;
	table: string;
}

/**
 * One projected field: `column` is the Athena select expression (or base column),
 * `key` is the flat-row alias after execution.
 */
export interface AthenaReadQueryColumn {
	column: string;
	key: string;
	label?: string;
	relation?: AthenaReadQueryRelationRef;
}

export type AthenaReadQueryFilterValue =
	| boolean
	| number
	| null
	| readonly (boolean | number | string | null)[]
	| string;

export interface AthenaReadQueryFilter {
	column: string;
	operator?: AthenaReadQueryFilterOperator;
	value: AthenaReadQueryFilterValue;
}

export interface AthenaReadQueryOrder {
	column: string;
	direction?: AthenaReadQueryOrderDirection;
}

export type AthenaReadQueryOrderByInput =
	| AthenaReadQueryOrder
	| readonly AthenaReadQueryOrder[];

/**
 * Portable read definition shared by SDK callers, app data proxies, and UI hooks.
 */
export interface AthenaReadQueryDefinition {
	columns: readonly AthenaReadQueryColumn[];
	countColumn: string;
	filters?: readonly AthenaReadQueryFilter[];
	/**
	 * Optional max total rows to expose from the result set.
	 * Caps reported `totalItems` and shortens the last page under that window.
	 * Does **not** replace `pageSize` for per-request page sizing — those fight
	 * when both are applied as SQL LIMIT.
	 */
	limit?: number;
	mode?: AthenaReadQueryMode;
	/** Single order or multi-column order list. */
	orderBy?: AthenaReadQueryOrderByInput;
	rowKey?: string;
	schema?: string;
	table: string;
}

export function normalizeAthenaReadQueryOrderBy(
	orderBy: AthenaReadQueryOrderByInput | undefined,
): AthenaReadQueryOrder[] {
	if (!orderBy) {
		return [];
	}
	const list = Array.isArray(orderBy) ? orderBy : [orderBy];
	return list.filter(
		(entry) =>
			entry &&
			typeof entry.column === "string" &&
			entry.column.trim().length > 0,
	);
}

export type AthenaReadQueryFlatRow = Record<string, unknown> & {
	__rowKey: string;
};

/** Minimal client shape: any `createClient(...)` result (or scoped view) with `.db`. */
export interface AthenaReadQueryClient {
	readonly db: AthenaClient["db"] | object;
}

export interface AthenaReadQueryExecutionInput {
	client: AthenaReadQueryClient;
	page: number;
	pageSize: number;
	query: AthenaReadQueryDefinition;
}

export interface AthenaReadQueryExecutionResult {
	debugAst?: AthenaQueryDebugAst;
	rows: AthenaReadQueryFlatRow[];
	totalItems: number;
}

// ---------------------------------------------------------------------------
// Back-compat table-oriented aliases (athena-auth-ui and existing consumers)
// ---------------------------------------------------------------------------

/** @deprecated Prefer {@link AthenaReadQueryMode}. */
export type AthenaTableQueryMode = AthenaReadQueryMode;
/** @deprecated Prefer {@link AthenaReadQueryFilterOperator}. */
export type AthenaTableFilterOperator = AthenaReadQueryFilterOperator;
/** @deprecated Prefer {@link AthenaReadQueryOrderDirection}. */
export type AthenaTableOrderDirection = AthenaReadQueryOrderDirection;
/** @deprecated Prefer {@link AthenaReadQueryRelationRef}. */
export type AthenaTableRelationRef = AthenaReadQueryRelationRef;
/** @deprecated Prefer {@link AthenaReadQueryColumn}. */
export type AthenaTableQueryColumn = AthenaReadQueryColumn;
/** @deprecated Prefer {@link AthenaReadQueryFilterValue}. */
export type AthenaTableFilterValue = AthenaReadQueryFilterValue;
/** @deprecated Prefer {@link AthenaReadQueryFilter}. */
export type AthenaTableFilter = AthenaReadQueryFilter;
/** @deprecated Prefer {@link AthenaReadQueryOrder}. */
export type AthenaTableOrder = AthenaReadQueryOrder;
/** @deprecated Prefer {@link AthenaReadQueryOrderByInput}. */
export type AthenaTableOrderByInput = AthenaReadQueryOrderByInput;
/** @deprecated Prefer {@link AthenaReadQueryDefinition}. */
export type AthenaTableQueryDefinition = AthenaReadQueryDefinition;
/** @deprecated Prefer {@link AthenaReadQueryFlatRow}. */
export type AthenaTableFlatRow = AthenaReadQueryFlatRow;
/** @deprecated Prefer {@link AthenaReadQueryClient}. */
export type AthenaTableQueryClient = AthenaReadQueryClient;
/** @deprecated Prefer {@link AthenaReadQueryExecutionInput}. */
export type AthenaTableQueryExecutionInput = AthenaReadQueryExecutionInput;
/** @deprecated Prefer {@link AthenaReadQueryExecutionResult}. */
export type AthenaTableQueryExecutionResult = AthenaReadQueryExecutionResult;

interface AthenaSelectRelationNode {
	schema?: string;
	select: AthenaSelectShape;
}

type AthenaSelectShape = Record<string, true | AthenaSelectRelationNode>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenAthenaRowValue(
	row: Record<string, unknown>,
	column: AthenaReadQueryColumn,
) {
	if (!column.relation) {
		return row[column.column];
	}

	const relationValue = row[column.relation.name];

	if (Array.isArray(relationValue)) {
		return relationValue
			.map((entry) => (isRecord(entry) ? entry[column.column] : undefined))
			.filter((entry) => entry !== undefined);
	}

	if (isRecord(relationValue)) {
		return relationValue[column.column];
	}
	return undefined;
}

function resolveFlatRowKey(
	row: AthenaReadQueryFlatRow,
	index: number,
	preferredKey: string | undefined,
) {
	const preferredValue =
		preferredKey && preferredKey in row ? row[preferredKey] : undefined;

	if (
		preferredValue !== undefined &&
		preferredValue !== null &&
		`${preferredValue}`.trim().length > 0
	) {
		return String(preferredValue);
	}

	for (const [key, value] of Object.entries(row)) {
		if (key === "__rowKey") {
			continue;
		}

		if (value === undefined || value === null) {
			continue;
		}

		if (Array.isArray(value)) {
			if (value.length > 0) {
				return `${key}-${value.join("-")}`;
			}

			continue;
		}

		const nextValue = String(value).trim();

		if (nextValue.length > 0) {
			return nextValue;
		}
	}

	return `row-${index + 1}`;
}

export function flattenAthenaReadQueryRows(
	rows: readonly unknown[],
	columns: readonly AthenaReadQueryColumn[],
	preferredKey: string | undefined,
) {
	return rows.map((entry, index) => {
		const sourceRow = isRecord(entry) ? entry : {};
		const flatRow = columns.reduce<AthenaReadQueryFlatRow>(
			(currentRow, column) => {
				currentRow[column.key] = flattenAthenaRowValue(sourceRow, column);
				return currentRow;
			},
			{ __rowKey: "" },
		);

		flatRow.__rowKey = resolveFlatRowKey(flatRow, index, preferredKey);

		return flatRow;
	});
}

/** @deprecated Prefer {@link flattenAthenaReadQueryRows}. */
export const flattenAthenaRows = flattenAthenaReadQueryRows;

export function buildAthenaReadQuerySelectString(
	columns: readonly AthenaReadQueryColumn[],
) {
	const baseColumns = columns
		.filter((column) => !column.relation)
		.map((column) => column.column);
	const relationGroups = new Map<
		string,
		{ columns: string[]; relation: AthenaReadQueryRelationRef }
	>();

	for (const column of columns) {
		if (!column.relation) {
			continue;
		}

		const groupKey = [
			column.relation.name,
			column.relation.schema ?? "",
			column.relation.table,
		].join(":");
		const existingGroup = relationGroups.get(groupKey);

		if (existingGroup) {
			if (!existingGroup.columns.includes(column.column)) {
				existingGroup.columns.push(column.column);
			}
			continue;
		}

		relationGroups.set(groupKey, {
			columns: [column.column],
			relation: column.relation,
		});
	}

	const relationColumns = [...relationGroups.values()].map(
		({ columns: relationColumns, relation }) => {
			const relationTarget = relation.schema
				? `${relation.schema}.${relation.table}`
				: relation.table;

			return `${relation.name}:${relationTarget}(${relationColumns.join(",")})`;
		},
	);

	return [...baseColumns, ...relationColumns].join(",");
}

/** @deprecated Prefer {@link buildAthenaReadQuerySelectString}. */
export const buildAthenaTableSelectString = buildAthenaReadQuerySelectString;

export function buildAthenaReadQueryFindManySelect(
	columns: readonly AthenaReadQueryColumn[],
) {
	const select: AthenaSelectShape = {};

	for (const column of columns) {
		if (!column.relation) {
			select[column.column] = true;
			continue;
		}

		const existingRelation = select[column.relation.name];

		if (
			existingRelation &&
			existingRelation !== true &&
			isRecord(existingRelation.select)
		) {
			existingRelation.select[column.column] = true;
			continue;
		}

		select[column.relation.name] = {
			...(column.relation.schema ? { schema: column.relation.schema } : {}),
			select: {
				[column.column]: true,
			},
		};
	}

	return select;
}

/** @deprecated Prefer {@link buildAthenaReadQueryFindManySelect}. */
export const buildAthenaTableFindManySelect =
	buildAthenaReadQueryFindManySelect;

export function buildAthenaReadQueryFindManyWhere(
	filters: readonly AthenaReadQueryFilter[] | undefined,
) {
	if (!filters?.length) {
		return undefined;
	}

	return filters.reduce<Record<string, AthenaReadQueryFilterValue | object>>(
		(where, filter) => {
			const operator = filter.operator ?? "eq";

			where[filter.column] =
				operator === "eq" ? filter.value : { [operator]: filter.value };

			return where;
		},
		{},
	);
}

/** @deprecated Prefer {@link buildAthenaReadQueryFindManyWhere}. */
export const buildAthenaTableFindManyWhere = buildAthenaReadQueryFindManyWhere;

/**
 * Builds findMany `orderBy` in the Athena SDK object shape.
 * Single-order keeps the legacy `{ column, ascending }` form for back-compat.
 */
export function buildAthenaReadQueryFindManyOrderBy(
	orderBy: AthenaReadQueryOrderByInput | undefined,
):
	| Record<string, "asc" | "desc" | { ascending: boolean }>
	| { ascending: boolean; column: string }
	| undefined {
	const normalized = normalizeAthenaReadQueryOrderBy(orderBy);
	if (normalized.length === 0) {
		return undefined;
	}

	if (normalized.length === 1) {
		const primary = normalized[0];
		if (!primary) {
			return undefined;
		}
		return {
			ascending: primary.direction !== "desc",
			column: primary.column,
		};
	}

	return Object.fromEntries(
		normalized.map((entry) => [
			entry.column,
			entry.direction === "desc" ? "desc" : "asc",
		]),
	);
}

/** @deprecated Prefer {@link buildAthenaReadQueryFindManyOrderBy}. */
export const buildAthenaTableFindManyOrderBy =
	buildAthenaReadQueryFindManyOrderBy;

/** @deprecated Prefer {@link normalizeAthenaReadQueryOrderBy}. */
export const normalizeAthenaTableOrderBy = normalizeAthenaReadQueryOrderBy;

export function applyAthenaReadQueryFilters<T extends object>(
	queryBuilder: T,
	filters: readonly AthenaReadQueryFilter[] | undefined,
) {
	if (!filters?.length) {
		return queryBuilder;
	}

	return filters.reduce<T>((currentBuilder, filter) => {
		const operator = filter.operator ?? "eq";
		const builderMethod = (currentBuilder as Record<string, unknown>)[operator];

		if (typeof builderMethod !== "function") {
			return currentBuilder;
		}

		return builderMethod.call(currentBuilder, filter.column, filter.value) as T;
	}, queryBuilder);
}

/** @deprecated Prefer {@link applyAthenaReadQueryFilters}. */
export const applyAthenaTableFilters = applyAthenaReadQueryFilters;

export function applyAthenaReadQuerySelectOrder<
	T extends { order: (column: string, options: { ascending: boolean }) => T },
>(queryBuilder: T, orderBy: AthenaReadQueryOrderByInput | undefined) {
	const normalized = normalizeAthenaReadQueryOrderBy(orderBy);
	if (normalized.length === 0) {
		return queryBuilder;
	}

	return normalized.reduce<T>(
		(builder, entry) =>
			builder.order(entry.column, {
				ascending: entry.direction !== "desc",
			}),
		queryBuilder,
	);
}

/** @deprecated Prefer {@link applyAthenaReadQuerySelectOrder}. */
export const applyAthenaTableSelectOrder = applyAthenaReadQuerySelectOrder;

export function applyAthenaReadQuerySelectLimit<
	T extends { limit: (value: number) => T },
>(queryBuilder: T, limit: number | undefined) {
	if (!limit || limit < 1) {
		return queryBuilder;
	}

	return queryBuilder.limit(limit);
}

/** @deprecated Prefer {@link applyAthenaReadQuerySelectLimit}. */
export const applyAthenaTableSelectLimit = applyAthenaReadQuerySelectLimit;

export function clampAthenaReadQueryTotalItems(
	totalItems: number,
	limit: number | undefined,
) {
	if (!limit || limit < 1) {
		return totalItems;
	}

	return Math.min(totalItems, limit);
}

/** @deprecated Prefer {@link clampAthenaReadQueryTotalItems}. */
export const clampAthenaTableTotalItems = clampAthenaReadQueryTotalItems;

function resolveCountValue(
	...candidates: Array<number | null | undefined>
): number {
	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			return Math.max(0, Math.trunc(candidate));
		}
	}
	return 0;
}

function resolveTotalItemsFromPage({
	countCandidates,
	limit,
	page,
	pageSize,
	rowCount,
}: {
	countCandidates: Array<number | null | undefined>;
	limit: number | undefined;
	page: number;
	pageSize: number;
	rowCount: number;
}) {
	const exactCount = resolveCountValue(...countCandidates);
	if (exactCount > 0) {
		return clampAthenaReadQueryTotalItems(exactCount, limit);
	}

	// Prefer a synthetic total over "0 results" when the page has rows
	// (count head failed or returned null while data succeeded).
	if (rowCount > 0) {
		const base = (page - 1) * pageSize + rowCount;
		const synthetic = rowCount >= pageSize ? base + 1 : base;
		return clampAthenaReadQueryTotalItems(synthetic, limit);
	}

	return clampAthenaReadQueryTotalItems(exactCount, limit);
}

/**
 * Resolves the page window for a paged read under an optional total-row cap.
 *
 * - `pageSize` owns the per-request fetch size.
 * - `query.limit` (when set) is a max total window, not a second LIMIT that
 *   overrides pageSize (which previously made the two controls fight).
 */
export function resolveAthenaReadQueryPageFetch({
	page,
	pageSize,
	limit,
}: {
	page: number;
	pageSize: number;
	limit?: number;
}): { page: number; pageSize: number; shouldFetch: boolean } {
	const safePage = Math.max(1, Math.trunc(page) || 1);
	const safePageSize = Math.max(1, Math.trunc(pageSize) || 1);

	if (!limit || limit < 1) {
		return { page: safePage, pageSize: safePageSize, shouldFetch: true };
	}

	const totalCap = Math.trunc(limit);
	const offset = (safePage - 1) * safePageSize;

	if (offset >= totalCap) {
		return { page: safePage, pageSize: safePageSize, shouldFetch: false };
	}

	return {
		page: safePage,
		pageSize: Math.min(safePageSize, totalCap - offset),
		shouldFetch: true,
	};
}

/**
 * Execute a portable {@link AthenaReadQueryDefinition} against a v3 Athena client.
 *
 * Pass `createClient({ url, key })` or a `withContext` / session-scoped view.
 * Does not construct clients and does not perform HTTP proxy routing.
 */
export async function executeAthenaReadQuery({
	client,
	page,
	pageSize,
	query,
}: AthenaReadQueryExecutionInput): Promise<AthenaReadQueryExecutionResult> {
	const db = (client as AthenaClient).db;
	const baseBuilder = db.from(query.table, {
		schema: query.schema,
	});
	const countBuilder = applyAthenaReadQueryFilters(
		db.from(query.table, { schema: query.schema }),
		query.filters,
	);
	const countResult = await countBuilder.select(query.countColumn, {
		count: "exact",
		head: true,
	});

	const pageFetch = resolveAthenaReadQueryPageFetch({
		limit: query.limit,
		page,
		pageSize,
	});

	if (!pageFetch.shouldFetch) {
		return {
			rows: [],
			totalItems: resolveTotalItemsFromPage({
				countCandidates: [countResult.count],
				limit: query.limit,
				page: pageFetch.page,
				pageSize,
				rowCount: 0,
			}),
		};
	}

	if ((query.mode ?? "findMany") === "select") {
		// Do not apply query.limit as builder.limit — pageSize owns the page LIMIT.
		// query.limit only caps totalItems / shortens the last page via pageFetch.
		const selectBuilder = applyAthenaReadQuerySelectOrder(
			applyAthenaReadQueryFilters(baseBuilder, query.filters),
			query.orderBy,
		);
		const result = await selectBuilder
			.currentPage(pageFetch.page)
			.pageSize(pageFetch.pageSize)
			.select(buildAthenaReadQuerySelectString(query.columns), {
				count: "exact",
			});
		const rows = flattenAthenaReadQueryRows(
			Array.isArray(result.data) ? result.data : [],
			query.columns,
			query.rowKey,
		);

		return {
			debugAst: getAthenaDebugAst(result) ?? undefined,
			rows,
			totalItems: resolveTotalItemsFromPage({
				countCandidates: [countResult.count, result.count],
				limit: query.limit,
				page: pageFetch.page,
				pageSize,
				rowCount: rows.length,
			}),
		};
	}

	const findManyOrderBy = buildAthenaReadQueryFindManyOrderBy(query.orderBy);
	// page/pageSize drive LIMIT/OFFSET. query.limit is a total-window cap only
	// (see resolveAthenaReadQueryPageFetch) — never both as SQL limits.
	const findManyOptions: Parameters<typeof baseBuilder.findMany>[0] = {
		...(findManyOrderBy ? { orderBy: findManyOrderBy } : {}),
		select: buildAthenaReadQueryFindManySelect(query.columns) as never,
		...(query.filters?.length
			? { where: buildAthenaReadQueryFindManyWhere(query.filters) as never }
			: {}),
	};

	const result = await baseBuilder
		.currentPage(pageFetch.page)
		.pageSize(pageFetch.pageSize)
		.findMany(findManyOptions);
	const rows = flattenAthenaReadQueryRows(
		Array.isArray(result.data) ? result.data : [],
		query.columns,
		query.rowKey,
	);

	return {
		debugAst: getAthenaDebugAst(result) ?? undefined,
		rows,
		totalItems: resolveTotalItemsFromPage({
			countCandidates: [countResult.count, result.count],
			limit: query.limit,
			page: pageFetch.page,
			pageSize,
			rowCount: rows.length,
		}),
	};
}

/**
 * @deprecated Prefer {@link executeAthenaReadQuery}. Same implementation.
 */
export const executeAthenaTableQuery = executeAthenaReadQuery;
