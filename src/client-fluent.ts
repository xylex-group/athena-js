import type {
	AthenaResult,
	AthenaResultError,
	AthenaResultFormatter,
} from "./client-result.ts";
import {
	applyCardinality,
	executeRead,
	toSingleResult,
} from "./client-result.ts";
import {
	buildDebugSelectQuery,
	buildDeleteDebugSql,
	buildIncludeJoinSelectQuery,
	buildInsertDebugSql,
	buildRpcDebugSql,
	buildTypedSelectQuery,
	buildUpdateDebugSql,
	resolveTableNameForCall,
} from "./client-sql.ts";
import type {
	AthenaConditionArrayValue,
	AthenaConditionCastType,
	AthenaConditionOperator,
	AthenaConditionValue,
	AthenaDeletePayload,
	AthenaGatewayCallOptions,
	AthenaGatewayCondition,
	AthenaGatewayErrorDetails,
	AthenaInsertPayload,
	AthenaJsonObject,
	AthenaJsonValue,
	AthenaRpcCallOptions,
	AthenaRpcFilter,
	AthenaRpcFilterOperator,
	AthenaRpcPayload,
	AthenaSortBy,
	AthenaUpdatePayload,
} from "./gateway/types.ts";

export type {
	AthenaRequestMethod,
	AthenaRequestOptions,
	AthenaRequestQueryValueMap,
	AthenaRequestResponse,
	AthenaRequestService,
} from "./client-request.ts";
export type { AthenaResult, AthenaResultError } from "./client-result.ts";

import {
	classifyRawSqlOperation,
	createAdminQuery,
	defaultExpectedShapeForOperation,
	maybeWarnRawQueryDeprecated,
} from "./admin/query.ts";
import { requireAffected } from "./auxiliaries.ts";
import { AthenaTransactionError } from "./db/transaction/errors.ts";
import {
	attachTransactionCompiler,
	nextTransactionOperationId,
} from "./db/transaction/index.ts";
import type { createAthenaGatewayClient } from "./gateway/client.ts";
import type {
	AthenaCacheContextDescriptor,
	AthenaExecutable,
	AthenaExecuteOptions,
	AthenaQueryDescriptor,
	AthenaQueryOperation,
	AthenaRelationDescriptor,
} from "./query/descriptor.ts";
import {
	compileAthenaQueryDescriptor,
	createCapturedAthenaExecutable,
} from "./query/descriptor.ts";
import type {
	AthenaFindManyOptions,
	AthenaFindManyResult,
	AthenaSelectShape,
	AthenaValidatedSelectShape,
} from "./query-ast.ts";
import {
	compileOrderBy,
	compileSelectShape,
	compileWhere,
	selectShapeHasNestedQueryModifiers,
	selectShapeUsesRelationSchema,
	shouldUseUuidTextComparison,
} from "./query-ast.ts";
import type { AthenaQueryDebugAst } from "./query-debug-ast.ts";
import {
	buildDeleteDebugAst,
	buildFindManyCompiledDebugAst,
	buildFindManyDirectDebugAst,
	buildInsertDebugAst,
	buildRawQueryDebugAst,
	buildRpcDebugAst,
	buildSelectDebugAst,
	buildUpdateDebugAst,
	buildUpsertDebugAst,
} from "./query-debug-ast.ts";
import type { AthenaQueryTracer } from "./query-tracing.ts";
import {
	captureTraceCallsite,
	createTraceCallsiteStore,
	executeWithQueryTrace,
} from "./query-tracing.ts";
import type { AthenaFindManyAstPayload } from "./query-transport.ts";
import {
	canUseFindManyAstTransport,
	createSelectTransportPlan,
	findManyAstWhereRequiresLegacyTransport,
	normalizeFindManyAstWhere,
	toFindManyAstOrder,
} from "./query-transport.ts";
import type {
	AthenaSelectInput,
	AthenaTypecheckedColumnKey,
	AthenaValidatedSelectInput,
} from "./select-column-types.ts";

export type {
	AthenaColumnKey,
	AthenaColumnKeyWithAutocomplete,
	AthenaResolvedColumnKey,
	AthenaSelectArrayElement,
	AthenaSelectColumnsFor,
	AthenaSelectInput,
	AthenaSelectInputHints,
	AthenaTypecheckedColumnKey,
	AthenaValidatedSelectInput,
	HasKnownSelectColumns,
} from "./select-column-types.ts";

import type {
	AthenaClientModelForTableName,
	AthenaClientTableName,
	AthenaModelTarget,
	InsertOf,
	RowOf,
	UpdateOf,
} from "./schema/types.ts";

export interface InternalClientBehaviorOptions {
	/**
	 * Build and attach a normalized operation AST for runtime debugging.
	 *
	 * When enabled, successful Athena results expose a non-enumerable debug AST
	 * that can be read with `getAthenaDebugAst(...)`. If tracing is also enabled,
	 * the same AST is included on emitted trace events.
	 */
	debugAst?: boolean;
	/**
	 * Send the original `findMany(...)` AST body for clean object-select reads.
	 * This requires gateway support and falls back to legacy compiled transport
	 * when a chain carries filter/pagination state that the AST payload cannot
	 * represent losslessly yet.
	 */
	findManyAst?: boolean;
	/**
	 * Allow schema-qualified relation nodes on the findMany AST payload.
	 * Hosted Gateway still falls back to PostgREST embed strings.
	 */
	findManyAstRelationSchema?: boolean;
	/**
	 * Control deprecation warnings for root `query()` (ATHENA_RAW_SQL_COMPAT_DEPRECATED).
	 * - `false`: never warn
	 * - `true`: always warn (once per client)
	 * - `auto` / omitted: warn in non-production only (once per client)
	 */
	rawQueryDiagnostics?: boolean | "auto";
	/**
	 * Retry retryable read failures (`select`, `findMany`, `query`) with a fixed internal policy.
	 *
	 * Applies two additional attempts with exponential backoff and jitter.
	 */
	retryReads?: boolean;
	/**
	 * Emit execution diagnostics for every query/mutation/RPC invocation.
	 * Includes payload, synthesized SQL, full outcome, and best-effort callsite metadata.
	 */
	traceQueries?: boolean | AthenaQueryTraceOptions;
}

export interface AthenaQueryTraceOptions {
	/**
	 * When false, tracing is off even if diagnostics mode would enable it.
	 * When true, tracing stays on even in quiet (`diagnostics: 'auto'`) environments.
	 * When omitted, quiet environments disable object-form trace options.
	 */
	enabled?: boolean;
	/**
	 * Custom sink for trace events. Defaults to console.info.
	 */
	logger?: (event: AthenaQueryTraceEvent) => void;
}

export interface AthenaQueryTraceCallsite {
	column: number;
	fileName: string;
	filePath: string;
	frame?: string;
	functionName?: string;
	line: number;
}

export interface AthenaQueryTraceEvent {
	ast?: AthenaQueryDebugAst;
	callsite: AthenaQueryTraceCallsite | null;
	durationMs: number;
	endpoint:
		| "/gateway/fetch"
		| "/gateway/insert"
		| "/gateway/update"
		| "/gateway/delete"
		| "/gateway/rpc"
		| "/gateway/query"
		| `/rpc/${string}`;
	functionName?: string;
	operation:
		| "select"
		| "insert"
		| "upsert"
		| "update"
		| "delete"
		| "rpc"
		| "query";
	options?: AthenaGatewayCallOptions | AthenaRpcCallOptions;
	outcome?: {
		status: number;
		error: AthenaResultError | null;
		errorDetails?: AthenaGatewayErrorDetails | null;
		count?: number | null;
		data: unknown;
		raw: unknown;
	};
	payload: unknown;
	sql: string;
	table?: string;
	thrownError?: unknown;
	timestamp: string;
}

interface TableBuilderState {
	cacheContext?: AthenaCacheContextDescriptor;
	conditions: AthenaGatewayCondition[];
	currentPage?: number;
	limit?: number;
	model?: AthenaModelTarget;
	offset?: number;
	order?: AthenaSortBy;
	pageSize?: number;
	relations?: AthenaRelationDescriptor[];
	totalPages?: number;
}

interface ConditionCastHints {
	columnCast?: AthenaConditionCastType;
	valueCast?: AthenaConditionCastType;
}

type MutationSingleResult<Result> =
	Result extends Array<infer Item> ? Item | null : Result | null;
type MutationResultRow<Result> =
	Result extends Array<infer Item> ? Item : Result;
export type AthenaRowShape = Record<string, AthenaJsonValue | undefined>;
type FilterColumnKey<Row> = Extract<keyof NonNullable<Row>, string>;
/** Known keys when the row shape is concrete; `string` when untyped / index signature. */
type ResolvedFilterColumnKey<Row> = [FilterColumnKey<Row>] extends [never]
	? string
	: string extends FilterColumnKey<Row>
		? string
		: FilterColumnKey<Row>;
/**
 * Table-name argument for free-form `from<Row>(table)`.
 * - No client `models` → `string` (nothing to complete).
 * - With `models` → known bare/qualified names (IntelliSense + reject unknowns).
 *   Prefer `.from("users")` without a row generic so the row type is inferred from the model.
 */
export type UntypedTableName<TModels> = [TModels] extends [never]
	? string
	: [AthenaClientTableName<TModels>] extends [never]
		? string
		: AthenaClientTableName<TModels>;
type ResolvedClientTableModel<TModels, TTableName extends string> = Extract<
	AthenaClientModelForTableName<TModels, TTableName>,
	AthenaModelTarget
>;
export type ClientTableQueryBuilder<
	TModels,
	TTableName extends string,
> = TableQueryBuilder<
	RowOf<ResolvedClientTableModel<TModels, TTableName>>,
	InsertOf<ResolvedClientTableModel<TModels, TTableName>>,
	UpdateOf<ResolvedClientTableModel<TModels, TTableName>>
>;
/**
 * Select/returning/single column input.
 *
 * - Typed row: validates string lists; arrays use the model-key union.
 * - Untyped row: plain `TValue` (`string | string[]`).
 */
type SelectColumnsFor<
	Row,
	TValue extends AthenaSelectInput,
> = AthenaValidatedSelectInput<Row, TValue>;
const DEFAULT_COLUMNS = "*";

type SelectDebugAstFactory = (input: {
	tableName: string;
	columns: string | string[];
	executionState: TableBuilderState;
	plan: ReturnType<typeof createSelectTransportPlan>;
}) => AthenaQueryDebugAst;

export interface MutationQuery<Result, Row = MutationResultRow<Result>>
	extends PromiseLike<AthenaResult<Result>>,
		AthenaExecutable<AthenaResult<Result>> {
	catch: <TResult = never>(
		onrejected?:
			| ((reason: unknown) => TResult | PromiseLike<TResult>)
			| undefined
			| null,
	) => Promise<AthenaResult<Result> | TResult>;
	finally: (
		onfinally?: (() => void) | undefined | null,
	) => Promise<AthenaResult<Result>>;
	requireAffected: (options?: {
		min?: number;
	}) => Promise<AthenaResult<Result>>;
	maybeSingle: <const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<MutationSingleResult<Result>>>;
	returning: <const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<Result>>;
	select: <const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<Result>>;
	single: <const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<MutationSingleResult<Result>>>;
	then: <TResult1 = AthenaResult<Result>, TResult2 = never>(
		onfulfilled?:
			| ((value: AthenaResult<Result>) => TResult1 | PromiseLike<TResult1>)
			| undefined
			| null,
		onrejected?:
			| ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
			| undefined
			| null,
	) => Promise<TResult1 | TResult2>;
}

function mergeOptions<T extends { headers?: Record<string, string> }>(
	...options: Array<T | undefined>
): T | undefined {
	return options.reduce<T | undefined>((acc, next) => {
		if (!next) {
			return acc;
		}
		const merged = { ...(acc ?? {}), ...next } as T;
		if (acc?.headers || next.headers) {
			merged.headers = {
				...(acc?.headers ?? {}),
				...(next.headers ?? {}),
			};
		}
		return merged;
	}, undefined);
}

function collectChangedFields(values: unknown): string[] {
	if (Array.isArray(values)) {
		const keys = new Set<string>();
		for (const value of values) {
			if (value && typeof value === "object") {
				for (const key of Object.keys(value as object)) {
					keys.add(key);
				}
			}
		}
		return [...keys];
	}
	if (values && typeof values === "object") {
		return Object.keys(values as object);
	}
	return [];
}

function asAthenaJsonObject(value: unknown): AthenaJsonObject {
	return value as unknown as AthenaJsonObject;
}

function asAthenaJsonObjectArray(values: unknown[]): AthenaJsonObject[] {
	return values as unknown as AthenaJsonObject[];
}

function normalizeSelectColumnsInput(
	columns?: AthenaSelectInput,
): string | string[] | undefined {
	if (columns === undefined) {
		return;
	}
	if (typeof columns === "string") {
		return columns;
	}
	return [...columns];
}

function createMutationQuery<Result, Row = MutationResultRow<Result>>(
	executor: (
		columns?: string | string[],
		options?: AthenaGatewayCallOptions,
		callsite?: AthenaQueryTraceCallsite | null,
	) => Promise<AthenaResult<Result>>,
	defaultColumns: AthenaSelectInput | null = DEFAULT_COLUMNS,
	tracer?: AthenaQueryTracer,
	initialCallsite?: AthenaQueryTraceCallsite | null,
	executable?: {
		getDescriptor: (
			projection: AthenaSelectInput | undefined,
		) => AthenaQueryDescriptor;
		model?: AthenaModelTarget;
	},
	compileTransaction?: (
		columns: string | string[] | undefined,
		options?: AthenaGatewayCallOptions,
	) => {
		kind: "fetch" | "insert" | "update" | "delete";
		payload:
			| import("./gateway/types.ts").AthenaFetchPayload
			| import("./gateway/types.ts").AthenaInsertPayload
			| import("./gateway/types.ts").AthenaUpdatePayload
			| import("./gateway/types.ts").AthenaDeletePayload;
	},
): MutationQuery<Result, Row> {
	let selectedColumns: AthenaSelectInput | undefined =
		defaultColumns === null ? undefined : defaultColumns;
	let selectedOptions: AthenaGatewayCallOptions | undefined;
	let promise: Promise<AthenaResult<Result>> | null = null;
	const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite);

	const run = (
		columns?: AthenaSelectInput,
		options?: AthenaGatewayCallOptions,
		callsite?: AthenaQueryTraceCallsite | null,
	) => {
		const payloadColumns = columns ?? selectedColumns;
		const payloadOptions = options ?? selectedOptions;
		if (!promise) {
			promise = executor(
				normalizeSelectColumnsInput(payloadColumns),
				payloadOptions,
				callsiteStore.resolve(callsite),
			);
		}
		return promise;
	};

	const mutationQuery: MutationQuery<Result, Row> = {
		capture() {
			const capturedColumns = selectedColumns;
			const capturedOptions = selectedOptions;
			return createCapturedAthenaExecutable({
				descriptor: mutationQuery.getDescriptor(),
				execute: (executeOptions) =>
					run(capturedColumns, {
						...capturedOptions,
						signal: executeOptions?.signal ?? capturedOptions?.signal,
					}),
				model: executable?.model,
			});
		},
		catch(onrejected) {
			return run(selectedColumns, selectedOptions).catch(onrejected);
		},
		execute(executeOptions?: AthenaExecuteOptions) {
			return run(selectedColumns, {
				...selectedOptions,
				signal: executeOptions?.signal ?? selectedOptions?.signal,
			});
		},
		finally(onfinally) {
			return run(selectedColumns, selectedOptions).finally(onfinally);
		},
		getDescriptor() {
			if (!executable) {
				throw new Error(
					"Mutation query is missing a descriptor compiler. Pass getDescriptor when constructing the mutation.",
				);
			}
			return executable.getDescriptor(selectedColumns);
		},
		async requireAffected(options?: { min?: number }) {
			const result = await run(selectedColumns, selectedOptions);
			requireAffected(result, options, {
				operation: executable ? "mutation" : undefined,
			});
			return result;
		},
		maybeSingle(
			columns?: AthenaSelectInput,
			options?: AthenaGatewayCallOptions,
		) {
			// Omit args keep the mutation default projection ("*") so PG/D1 emit RETURNING.
			if (columns !== undefined) {
				selectedColumns = columns;
			}
			selectedOptions = options ?? selectedOptions;
			return run(
				columns ?? selectedColumns,
				options ?? selectedOptions,
				captureTraceCallsite(tracer),
			).then((result) => applyCardinality(result, "maybeSingle"));
		},
		returning(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
			return mutationQuery.select(columns, options);
		},
		select(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
			selectedColumns = columns;
			selectedOptions = options ?? selectedOptions;
			return run(columns, options, captureTraceCallsite(tracer));
		},
		single(columns?: AthenaSelectInput, options?: AthenaGatewayCallOptions) {
			// Omit args keep the mutation default projection ("*") so PG/D1 emit RETURNING.
			if (columns !== undefined) {
				selectedColumns = columns;
			}
			selectedOptions = options ?? selectedOptions;
			return run(
				columns ?? selectedColumns,
				options ?? selectedOptions,
				captureTraceCallsite(tracer),
			).then((result) => applyCardinality(result, "single"));
		},
		// Thenable so `await query` resolves the deferred run without an extra API.
		// biome-ignore lint/suspicious/noThenProperty: intentional thenable query builder
		then(onfulfilled, onrejected) {
			return run(selectedColumns, selectedOptions).then(
				onfulfilled,
				onrejected,
			);
		},
	};

	if (executable?.model) {
		Object.defineProperty(mutationQuery, "model", {
			enumerable: true,
			value: executable.model,
		});
	}

	if (compileTransaction) {
		attachTransactionCompiler(mutationQuery, () => {
			const compiled = compileTransaction(
				normalizeSelectColumnsInput(selectedColumns),
				selectedOptions,
			);
			return {
				descriptor: mutationQuery.getDescriptor(),
				id: nextTransactionOperationId(),
				index: 0,
				kind: compiled.kind,
				payload: compiled.payload,
			} as import("./db/transaction/types.ts").AthenaTransactionOperation;
		});
	}

	return mutationQuery;
}

export interface OrderOptions {
	ascending?: boolean;
}

/** Shared filter chain - supports eq, limit, etc. in any order relative to select/update */
interface FilterChain<Self, Row> {
	containedBy: (
		column: ResolvedFilterColumnKey<Row>,
		values: AthenaConditionArrayValue,
	) => Self;
	contains: (
		column: ResolvedFilterColumnKey<Row>,
		values: AthenaConditionArrayValue,
	) => Self;
	currentPage: (value: number) => Self;
	eq: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	eqCast: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
		cast: AthenaConditionCastType,
	) => Self;
	eqUuid: (column: ResolvedFilterColumnKey<Row>, value: string) => Self;
	gt: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	gte: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	ilike: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	in: (
		column: ResolvedFilterColumnKey<Row>,
		values: AthenaConditionArrayValue,
	) => Self;
	is: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	like: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	limit: (count: number) => Self;
	lt: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	lte: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	match: (
		filters: Partial<
			Record<ResolvedFilterColumnKey<Row>, AthenaConditionValue>
		>,
	) => Self;
	neq: (
		column: ResolvedFilterColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	not: (
		columnOrExpression: ResolvedFilterColumnKey<Row> | string,
		operator?: AthenaConditionOperator,
		value?: AthenaConditionValue,
	) => Self;
	offset: (count: number) => Self;
	or: (expression: string) => Self;
	order: (column: ResolvedFilterColumnKey<Row>, options?: OrderOptions) => Self;
	pageSize: (value: number) => Self;
	range: (from: number, to: number) => Self;
	totalPages: (value: number) => Self;
}

/** Chain returned by select() - supports filters and single/maybeSingle before execution */
export interface SelectChain<Row, SelectedRow = Row>
	extends FilterChain<SelectChain<Row, SelectedRow>, Row>,
		PromiseLike<AthenaResult<SelectedRow[]>>,
		AthenaExecutable<AthenaResult<SelectedRow[]>> {
	maybeSingle: <
		T = SelectedRow,
		const TColumns extends AthenaSelectInput = string,
	>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<T | null>>;
	single: <T = SelectedRow, const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<T | null>>;
}

/** Chain returned by update() - supports filters before execution, plus select/returning */
export interface UpdateChain<Row>
	extends FilterChain<UpdateChain<Row>, Row>,
		MutationQuery<Row[], Row> {}

interface RpcFilterChain<Self, Row> {
	eq: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	gt: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	gte: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	ilike: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	in: (
		column: AthenaTypecheckedColumnKey<Row>,
		values: AthenaConditionArrayValue,
	) => Self;
	is: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	like: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	lt: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	lte: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
	neq: (
		column: AthenaTypecheckedColumnKey<Row>,
		value: AthenaConditionValue,
	) => Self;
}

export interface RpcOrderOptions {
	ascending?: boolean;
}

export interface RpcQueryBuilder<Row>
	extends RpcFilterChain<RpcQueryBuilder<Row>, Row>,
		PromiseLike<AthenaResult<Row[]>> {
	limit: (count: number) => RpcQueryBuilder<Row>;
	maybeSingle: <T = Row, const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaRpcCallOptions,
	) => Promise<AthenaResult<T | null>>;
	offset: (count: number) => RpcQueryBuilder<Row>;
	order: (
		column: AthenaTypecheckedColumnKey<Row>,
		options?: RpcOrderOptions,
	) => RpcQueryBuilder<Row>;
	range: (from: number, to: number) => RpcQueryBuilder<Row>;
	select: <const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaRpcCallOptions,
	) => Promise<AthenaResult<Row[]>>;
	single: <T = Row, const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaRpcCallOptions,
	) => Promise<AthenaResult<T | null>>;
}

export interface AthenaFromOptions {
	schema?: string;
}

export interface TableQueryIncludeSpec {
	schema?: string;
	select?: readonly string[];
	targetModel?: string;
}

export type TableQueryIncludeRelations = Record<
	string,
	TableQueryIncludeSpec | true
>;

export interface TableQueryBuilder<
	Row,
	Insert = Partial<Row>,
	Update = Partial<Insert>,
	TContext = unknown,
> extends FilterChain<TableQueryBuilder<Row, Insert, Update, TContext>, Row> {
	delete: (
		options?: AthenaGatewayCallOptions & { resourceId?: string },
	) => MutationQuery<Row | null, Row>;
	findMany: <const TSelect extends AthenaSelectShape>(
		options: AthenaFindManyOptions<Row, TSelect> & {
			select: AthenaValidatedSelectShape<Row, TSelect>;
		},
	) => Promise<AthenaResult<AthenaFindManyResult<Row, TSelect, TContext>[]>>;
	insert(
		values: Insert,
		options?: AthenaGatewayCallOptions,
	): MutationQuery<Row, Row>;
	insert(
		values: Insert[],
		options?: AthenaGatewayCallOptions,
	): MutationQuery<Row[], Row>;
	maybeSingle: <T = Row, const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<T | null>>;
	include: (
		relations: TableQueryIncludeRelations,
	) => TableQueryBuilder<Row, Insert, Update, TContext>;
	readonly model?: AthenaModelTarget;
	reset: () => TableQueryBuilder<Row, Insert, Update, TContext>;
	select: <T = Row, const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => SelectChain<Row, T>;
	single: <T = Row, const TColumns extends AthenaSelectInput = string>(
		columns?: SelectColumnsFor<Row, TColumns>,
		options?: AthenaGatewayCallOptions,
	) => Promise<AthenaResult<T | null>>;
	update: (
		values: Update,
		options?: AthenaGatewayCallOptions,
	) => UpdateChain<Row>;
	upsert(
		values: Insert,
		options?: AthenaGatewayCallOptions & {
			updateBody?: Update;
			onConflict?:
				| ResolvedFilterColumnKey<Row>
				| ResolvedFilterColumnKey<Row>[]
				| (string & {})
				| Array<string & {}>;
		},
	): MutationQuery<Row, Row>;
	upsert(
		values: Insert[],
		options?: AthenaGatewayCallOptions & {
			updateBody?: Update;
			onConflict?:
				| ResolvedFilterColumnKey<Row>
				| ResolvedFilterColumnKey<Row>[]
				| (string & {})
				| Array<string & {}>;
		},
	): MutationQuery<Row[], Row>;
}

function getResourceId(state: TableBuilderState): string | undefined {
	const candidate = state.conditions.find(
		(condition) =>
			condition.operator === "eq" &&
			(condition.column === "resource_id" || condition.column === "id"),
	);
	return candidate?.value?.toString();
}

function stringifyFilterValue(
	value: AthenaConditionValue | AthenaConditionArrayValue | string,
): string {
	if (Array.isArray(value)) {
		return value.join(",");
	}
	return String(value);
}

function createFilterMethods<Self, Row>(
	state: TableBuilderState,
	addCondition: (
		operator: AthenaConditionOperator,
		column?: string,
		value?: AthenaConditionValue | AthenaConditionArrayValue | string,
		hints?: ConditionCastHints,
	) => void,
	self: Self,
): FilterChain<Self, Row> {
	return {
		containedBy(
			column: ResolvedFilterColumnKey<Row>,
			values: AthenaConditionArrayValue,
		) {
			addCondition("containedBy", String(column), values);
			return self;
		},
		contains(
			column: ResolvedFilterColumnKey<Row>,
			values: AthenaConditionArrayValue,
		) {
			addCondition("contains", String(column), values);
			return self;
		},
		currentPage(value: number) {
			state.currentPage = value;
			return self;
		},
		eq(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			const columnName = String(column);
			if (shouldUseUuidTextComparison(columnName, value)) {
				addCondition("eq", columnName, value, { columnCast: "text" });
			} else {
				addCondition("eq", columnName, value);
			}
			return self;
		},
		eqCast(
			column: ResolvedFilterColumnKey<Row>,
			value: AthenaConditionValue,
			cast: AthenaConditionCastType,
		) {
			addCondition("eq", String(column), value, { valueCast: cast });
			return self;
		},
		eqUuid(column: ResolvedFilterColumnKey<Row>, value: string) {
			addCondition("eq", String(column), value, { valueCast: "uuid" });
			return self;
		},
		gt(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("gt", String(column), value);
			return self;
		},
		gte(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("gte", String(column), value);
			return self;
		},
		ilike(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("ilike", String(column), value);
			return self;
		},
		in(
			column: ResolvedFilterColumnKey<Row>,
			values: AthenaConditionArrayValue,
		) {
			addCondition("in", String(column), values);
			return self;
		},
		is(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("is", String(column), value);
			return self;
		},
		like(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("like", String(column), value);
			return self;
		},
		limit(count: number) {
			state.limit = count;
			return self;
		},
		lt(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("lt", String(column), value);
			return self;
		},
		lte(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("lte", String(column), value);
			return self;
		},
		match(
			filters: Partial<
				Record<ResolvedFilterColumnKey<Row>, AthenaConditionValue>
			>,
		) {
			Object.entries(
				filters as Record<string, AthenaConditionValue | undefined>,
			).forEach(([column, value]) => {
				if (value === undefined) {
					return;
				}
				if (shouldUseUuidTextComparison(column, value)) {
					addCondition("eq", column, value, { columnCast: "text" });
				} else {
					addCondition("eq", column, value);
				}
			});
			return self;
		},
		neq(column: ResolvedFilterColumnKey<Row>, value: AthenaConditionValue) {
			addCondition("neq", String(column), value);
			return self;
		},
		not(
			columnOrExpression: ResolvedFilterColumnKey<Row> | string,
			operator?: AthenaConditionOperator,
			value?: AthenaConditionValue,
		) {
			const expression = String(columnOrExpression);
			if (operator !== null && value !== undefined) {
				addCondition(
					"not",
					undefined,
					`${expression}.${operator}.${stringifyFilterValue(value)}`,
				);
			} else {
				addCondition("not", undefined, expression);
			}
			return self;
		},
		offset(count: number) {
			state.offset = count;
			return self;
		},
		or(expression: string) {
			addCondition("or", undefined, expression);
			return self;
		},
		order(column: ResolvedFilterColumnKey<Row>, options?: OrderOptions) {
			state.order = {
				direction: options?.ascending === false ? "descending" : "ascending",
				field: String(column),
			};
			return self;
		},
		pageSize(value: number) {
			state.pageSize = value;
			return self;
		},
		range(from: number, to: number) {
			state.offset = from;
			state.limit = to - from + 1;
			return self;
		},
		totalPages(value: number) {
			state.totalPages = value;
			return self;
		},
	};
}

function toRpcSelect(columns?: AthenaSelectInput) {
	if (!columns) {
		return;
	}
	if (typeof columns === "string") {
		return columns;
	}
	return columns.join(",");
}

function createRpcFilterMethods<Self>(filters: AthenaRpcFilter[], self: Self) {
	const addFilter = (
		operator: AthenaRpcFilterOperator,
		column: string,
		value: AthenaConditionValue | AthenaConditionArrayValue | string,
	) => {
		filters.push({ column, operator, value });
	};

	return {
		eq(column: string, value: AthenaConditionValue) {
			addFilter("eq", column, value);
			return self;
		},
		gt(column: string, value: AthenaConditionValue) {
			addFilter("gt", column, value);
			return self;
		},
		gte(column: string, value: AthenaConditionValue) {
			addFilter("gte", column, value);
			return self;
		},
		ilike(column: string, value: AthenaConditionValue) {
			addFilter("ilike", column, value);
			return self;
		},
		in(column: string, values: AthenaConditionArrayValue) {
			addFilter("in", column, values);
			return self;
		},
		is(column: string, value: AthenaConditionValue) {
			addFilter("is", column, value);
			return self;
		},
		like(column: string, value: AthenaConditionValue) {
			addFilter("like", column, value);
			return self;
		},
		lt(column: string, value: AthenaConditionValue) {
			addFilter("lt", column, value);
			return self;
		},
		lte(column: string, value: AthenaConditionValue) {
			addFilter("lte", column, value);
			return self;
		},
		neq(column: string, value: AthenaConditionValue) {
			addFilter("neq", column, value);
			return self;
		},
	};
}

export function createRpcBuilder<Row>(
	functionName: string,
	args: AthenaJsonObject | undefined,
	baseOptions: AthenaRpcCallOptions | undefined,
	client: ReturnType<typeof createAthenaGatewayClient>,
	formatGatewayResult: AthenaResultFormatter,
	tracer?: AthenaQueryTracer,
	initialCallsite?: AthenaQueryTraceCallsite | null,
	debugAstEnabled = false,
): RpcQueryBuilder<Row> {
	const state: {
		filters: AthenaRpcFilter[];
		limit?: number;
		offset?: number;
		order?: { column: string; ascending?: boolean };
	} = {
		filters: [],
	};

	let selectedColumns: AthenaSelectInput | undefined;
	let selectedOptions: AthenaRpcCallOptions | undefined;
	let promise: Promise<AthenaResult<Row[]>> | null = null;
	const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite);

	const executeRpc = async <SelectedRow = Row>(
		columns?: AthenaSelectInput,
		options?: AthenaRpcCallOptions,
		callsite?: AthenaQueryTraceCallsite | null,
	): Promise<AthenaResult<SelectedRow[]>> => {
		const mergedOptions = mergeOptions(baseOptions, options);
		const normalizedSelectedColumns = normalizeSelectColumnsInput(columns);
		const payload: AthenaRpcPayload = {
			args,
			count: mergedOptions?.count,
			filters: state.filters.length ? [...state.filters] : undefined,
			function: functionName,
			head: mergedOptions?.head,
			limit: state.limit,
			offset: state.offset,
			order: state.order,
			schema: mergedOptions?.schema,
			select: toRpcSelect(columns),
		};
		const endpoint: AthenaQueryTraceEvent["endpoint"] = mergedOptions?.get
			? `/rpc/${functionName}`
			: "/gateway/rpc";
		const sql = buildRpcDebugSql(payload);
		const debugAst = debugAstEnabled
			? buildRpcDebugAst({
					args,
					endpoint,
					functionName,
					payload,
					selectedColumns: normalizedSelectedColumns,
					state,
				})
			: undefined;
		return executeWithQueryTrace(
			tracer,
			{
				ast: debugAst,
				endpoint,
				functionName,
				operation: "rpc",
				options: mergedOptions,
				payload,
				sql,
			},
			async () => {
				const response = await client.rpcGateway<SelectedRow[]>(
					payload,
					mergedOptions,
				);
				return formatGatewayResult(response, { operation: "rpc" });
			},
			callsite,
		);
	};

	const run = (
		columns?: AthenaSelectInput,
		options?: AthenaRpcCallOptions,
		callsite?: AthenaQueryTraceCallsite | null,
	) => {
		const payloadColumns = columns ?? selectedColumns;
		const payloadOptions = options ?? selectedOptions;
		if (!promise) {
			promise = executeRpc<Row>(
				payloadColumns,
				payloadOptions,
				callsiteStore.resolve(callsite),
			);
		}
		return promise;
	};

	const builder = {} as RpcQueryBuilder<Row>;
	const filterMethods = createRpcFilterMethods(state.filters, builder);

	Object.assign(builder, filterMethods, {
		catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
			return run(selectedColumns, selectedOptions).catch(onrejected);
		},
		finally(onfinally?: () => void) {
			return run(selectedColumns, selectedOptions).finally(onfinally);
		},
		limit(count: number) {
			state.limit = count;
			return builder;
		},
		maybeSingle<T = Row>(
			columns?: AthenaSelectInput,
			options?: AthenaRpcCallOptions,
		) {
			return builder.single<T, AthenaSelectInput>(columns, options);
		},
		offset(count: number) {
			state.offset = count;
			return builder;
		},
		order(column: string, options?: RpcOrderOptions) {
			state.order = { ascending: options?.ascending ?? true, column };
			return builder;
		},
		range(from: number, to: number) {
			state.offset = from;
			state.limit = to - from + 1;
			return builder;
		},
		select(columns?: AthenaSelectInput, options?: AthenaRpcCallOptions) {
			selectedColumns = columns;
			selectedOptions = options ?? selectedOptions;
			return run(columns, options, captureTraceCallsite(tracer));
		},
		async single<T = Row>(
			columns?: AthenaSelectInput,
			options?: AthenaRpcCallOptions,
		) {
			const result = await run(columns, options, captureTraceCallsite(tracer));
			return toSingleResult(result) as unknown as AthenaResult<T | null>;
		},
		// Thenable so `await query` resolves the deferred run without an extra API.
		// biome-ignore lint/suspicious/noThenProperty: intentional thenable query builder
		then<T1 = AthenaResult<Row[]>, T2 = never>(
			onfulfilled?: (v: AthenaResult<Row[]>) => T1 | PromiseLike<T1>,
			onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
		) {
			return run(selectedColumns, selectedOptions).then(
				onfulfilled,
				onrejected,
			);
		},
	});

	return builder;
}

export function createTableBuilder<
	Row,
	Insert = Partial<Row>,
	Update = Partial<Insert>,
	TContext = unknown,
>(
	tableName: string,
	client: ReturnType<typeof createAthenaGatewayClient>,
	formatGatewayResult: AthenaResultFormatter,
	tracer?: AthenaQueryTracer,
	behavior?: InternalClientBehaviorOptions,
	builderOptions?: {
		cacheContext?: AthenaCacheContextDescriptor;
		model?: AthenaModelTarget;
	},
): TableQueryBuilder<Row, Insert, Update, TContext> {
	const state: TableBuilderState = {
		cacheContext: builderOptions?.cacheContext,
		conditions: [],
		model: builderOptions?.model,
	};
	const debugAstEnabled = Boolean(behavior?.debugAst);

	const addCondition = (
		operator: AthenaConditionOperator,
		column?: string,
		value?: AthenaConditionValue | AthenaConditionArrayValue | string,
		hints?: ConditionCastHints,
	) => {
		const condition: AthenaGatewayCondition = { operator };
		if (column) {
			condition.column = column;
			if (operator === "eq") {
				// include legacy gateway shape for compatibility
				condition.eq_column = column;
			}
		}
		if (value !== undefined) {
			condition.value = value;
			if (operator === "eq") {
				condition.eq_value = value;
			}
		}
		if (hints?.valueCast) {
			condition.value_cast = hints.valueCast;
			if (operator === "eq") {
				condition.eq_value_cast = hints.valueCast;
			}
		}
		if (hints?.columnCast) {
			condition.column_cast = hints.columnCast;
			if (operator === "eq") {
				condition.eq_column_cast = hints.columnCast;
			}
		}
		state.conditions.push(condition);
	};

	const snapshotState = (): TableBuilderState => ({
		cacheContext: state.cacheContext,
		conditions: state.conditions.map((condition) => ({ ...condition })),
		currentPage: state.currentPage,
		limit: state.limit,
		model: state.model,
		offset: state.offset,
		order: state.order ? { ...state.order } : undefined,
		pageSize: state.pageSize,
		relations: state.relations ? [...state.relations] : undefined,
		totalPages: state.totalPages,
	});

	const compileDescriptor = (
		operation: AthenaQueryOperation,
		projection?: AthenaSelectInput | null,
		changedFields?: readonly string[],
	): AthenaQueryDescriptor =>
		compileAthenaQueryDescriptor({
			changedFields,
			conditions: state.conditions,
			context: state.cacheContext,
			currentPage: state.currentPage,
			limit: state.limit,
			model: state.model,
			offset: state.offset,
			operation,
			order: state.order,
			pageSize: state.pageSize,
			projection:
				projection === null
					? null
					: (normalizeSelectColumnsInput(projection) ?? "*"),
			relations: state.relations,
			tableName,
		});

	const mutationExecutable = (
		operation: AthenaQueryOperation,
		changedFields?: readonly string[],
	) => ({
		getDescriptor: (projection: AthenaSelectInput | undefined) =>
			compileDescriptor(operation, projection ?? null, changedFields),
		model: state.model,
	});

	const builder = {} as TableQueryBuilder<Row, Insert, Update, TContext>;

	const filterMethods = createFilterMethods<
		TableQueryBuilder<Row, Insert, Update, TContext>,
		Row
	>(state, addCondition, builder);

	const runSelect = async <T = Row>(
		columns: AthenaSelectInput = DEFAULT_COLUMNS,
		options?: AthenaGatewayCallOptions,
		executionState: TableBuilderState = snapshotState(),
		callsite?: AthenaQueryTraceCallsite | null,
		debugAstFactory?: SelectDebugAstFactory,
	) => {
		const runtimeColumns =
			normalizeSelectColumnsInput(columns) ?? DEFAULT_COLUMNS;
		const resolvedTableName = resolveTableNameForCall(
			tableName,
			options?.schema,
		);
		const plan = createSelectTransportPlan({
			buildTypedSelectQuery,
			columns: runtimeColumns,
			options,
			state: executionState,
			tableName: resolvedTableName,
		});
		const debugAst = debugAstEnabled
			? (debugAstFactory?.({
					columns: runtimeColumns,
					executionState,
					plan,
					tableName: resolvedTableName,
				}) ??
				buildSelectDebugAst({
					columns: runtimeColumns,
					plan,
					state: executionState,
					tableName: resolvedTableName,
				}))
			: undefined;

		const includeSql =
			executionState.relations && executionState.relations.length > 0
				? buildIncludeJoinSelectQuery({
						columns: runtimeColumns,
						conditions: executionState.conditions,
						limit: executionState.limit,
						offset: executionState.offset,
						order: executionState.order,
						relations: executionState.relations,
						tableName: resolvedTableName,
					})
				: null;

		if (plan.kind === "query") {
			return executeRead(behavior, () =>
				executeWithQueryTrace(
					tracer,
					{
						ast: debugAst,
						endpoint: "/gateway/query",
						operation: "select",
						options,
						payload: plan.payload,
						sql: includeSql ?? plan.query,
						table: resolvedTableName,
					},
					async () => {
						const queryResponse = await client.queryGateway<T>(
							plan.payload,
							options,
						);
						return formatGatewayResult(queryResponse, {
							operation: "select",
							table: resolvedTableName,
						});
					},
					callsite,
				),
			);
		}

		const sql =
			includeSql ??
			buildDebugSelectQuery({
				tableName: resolvedTableName,
				...plan.debug,
			});
		return executeRead(behavior, () =>
			executeWithQueryTrace(
				tracer,
				{
					ast: debugAst,
					endpoint: "/gateway/fetch",
					operation: "select",
					options,
					payload: plan.payload,
					sql,
					table: resolvedTableName,
				},
				async () => {
					const response = await client.fetchGateway<T>(plan.payload, options);
					return formatGatewayResult(response, {
						operation: "select",
						table: resolvedTableName,
					});
				},
				callsite,
			),
		);
	};

	const createSelectChain = <SelectedRow>(
		columns: AthenaSelectInput,
		options?: AthenaGatewayCallOptions,
		initialCallsite?: AthenaQueryTraceCallsite | null,
	): SelectChain<Row, SelectedRow> => {
		const chain = {} as SelectChain<Row, SelectedRow>;
		const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite);
		const filterMethods = createFilterMethods<
			SelectChain<Row, SelectedRow>,
			Row
		>(state, addCondition, chain);
		Object.assign(chain, filterMethods, {
			capture() {
				const frozenState = snapshotState();
				return createCapturedAthenaExecutable({
					descriptor: compileDescriptor("select", columns),
					execute: (executeOptions) =>
						runSelect<SelectedRow[]>(
							columns,
							{
								...options,
								signal: executeOptions?.signal ?? options?.signal,
							},
							frozenState,
							callsiteStore.resolve(),
						),
					model: state.model,
				});
			},
			catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
				return runSelect<SelectedRow[]>(
					columns,
					options,
					snapshotState(),
					callsiteStore.resolve(),
				).catch(onrejected);
			},
			execute(executeOptions?: AthenaExecuteOptions) {
				return runSelect<SelectedRow[]>(
					columns,
					{
						...options,
						signal: executeOptions?.signal ?? options?.signal,
					},
					snapshotState(),
					callsiteStore.resolve(),
				);
			},
			finally(onfinally?: () => void) {
				return runSelect<SelectedRow[]>(
					columns,
					options,
					snapshotState(),
					callsiteStore.resolve(),
				).finally(onfinally);
			},
			getDescriptor() {
				return compileDescriptor("select", columns);
			},
			maybeSingle<T = SelectedRow>(
				cols?: AthenaSelectInput,
				opts?: AthenaGatewayCallOptions,
			) {
				return runSelect<T[]>(
					cols ?? columns,
					opts ?? options,
					snapshotState(),
					callsiteStore.resolve(captureTraceCallsite(tracer)),
				).then((r) => applyCardinality(r, "maybeSingle"));
			},
			model: state.model,
			async single<T = SelectedRow>(
				cols?: AthenaSelectInput,
				opts?: AthenaGatewayCallOptions,
			) {
				const r = await runSelect<T[]>(
					cols ?? columns,
					opts ?? options,
					snapshotState(),
					callsiteStore.resolve(captureTraceCallsite(tracer)),
				);
				return applyCardinality(r, "single");
			},
			// Thenable so `await query` resolves the deferred run without an extra API.
			// biome-ignore lint/suspicious/noThenProperty: intentional thenable query builder
			then<T1 = AthenaResult<SelectedRow[]>, T2 = never>(
				onfulfilled?: (v: AthenaResult<SelectedRow[]>) => T1 | PromiseLike<T1>,
				onrejected?: (reason: unknown) => T2 | PromiseLike<T2>,
			) {
				return runSelect<SelectedRow[]>(
					columns,
					options,
					snapshotState(),
					callsiteStore.resolve(),
				).then(onfulfilled, onrejected);
			},
		});
		attachTransactionCompiler(chain, () => {
			const executionState = snapshotState();
			const runtimeColumns =
				normalizeSelectColumnsInput(columns) ?? DEFAULT_COLUMNS;
			const resolvedTableName = resolveTableNameForCall(
				tableName,
				options?.schema,
			);
			const plan = createSelectTransportPlan({
				buildTypedSelectQuery,
				columns: runtimeColumns,
				options,
				state: executionState,
				tableName: resolvedTableName,
			});
			if (plan.kind !== "fetch") {
				throw new AthenaTransactionError(
					"ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
					"This select cannot be compiled into a portable transaction fetch (raw SQL fallback is not transaction IR)",
					{ table: resolvedTableName },
				);
			}
			return {
				descriptor: compileDescriptor("select", columns),
				id: nextTransactionOperationId(),
				index: 0,
				kind: "fetch",
				payload: plan.payload,
			};
		});
		return chain;
	};

	Object.assign(builder, filterMethods, {
		include(relations: TableQueryIncludeRelations) {
			const meta = state.model?.meta.relations;
			state.relations = Object.keys(relations)
				.sort((left, right) => left.localeCompare(right))
				.map((name) => {
					const spec = relations[name];
					const relMeta = meta?.[name];
					const selected = spec === true ? undefined : spec?.select;
					return {
						columns: selected,
						name,
						sourceColumns: relMeta?.sourceColumns,
						star: spec === true || !selected?.length,
						targetColumns: relMeta?.targetColumns,
						targetModel:
							spec === true
								? relMeta?.targetModel
								: (spec?.targetModel ?? relMeta?.targetModel),
						targetSchema:
							spec === true
								? relMeta?.targetSchema
								: (spec?.schema ?? relMeta?.targetSchema),
						via: relMeta?.targetModel,
					};
				});
			return builder;
		},
		delete(options?: AthenaGatewayCallOptions & { resourceId?: string }) {
			const filters = state.conditions.length
				? [...state.conditions]
				: undefined;
			const resourceId = options?.resourceId ?? getResourceId(state);
			if (!(resourceId || filters?.length)) {
				throw new Error(
					'delete requires a resource_id either via eq("resource_id", ...) or options.resourceId',
				);
			}
			const mutationCallsite = captureTraceCallsite(tracer);
			const executeDelete = async (
				columns?: string | string[],
				selectOptions?: AthenaGatewayCallOptions,
				callsite?: AthenaQueryTraceCallsite | null,
			) => {
				const executionState = snapshotState();
				const debugState: TableBuilderState = {
					...executionState,
					conditions: filters
						? filters.map((condition) => ({ ...condition }))
						: [],
				};
				const mergedOptions = mergeOptions(options, selectOptions);
				const resolvedTableName = resolveTableNameForCall(
					tableName,
					mergedOptions?.schema,
				);
				const payload: AthenaDeletePayload = {
					conditions: filters,
					resource_id: resourceId,
					table_name: resolvedTableName,
				};
				if (executionState.order) {
					payload.sort_by = executionState.order;
				}
				if (executionState.limit !== undefined) {
					payload.limit = executionState.limit;
				}
				if (executionState.offset !== undefined) {
					payload.offset = executionState.offset;
				}
				if (executionState.currentPage !== undefined) {
					payload.current_page = executionState.currentPage;
				}
				if (executionState.pageSize !== undefined) {
					payload.page_size = executionState.pageSize;
				}
				if (executionState.totalPages !== undefined) {
					payload.total_pages = executionState.totalPages;
				}
				if (columns) {
					payload.columns = columns;
				}
				const sql = buildDeleteDebugSql(payload);
				const debugAst = debugAstEnabled
					? buildDeleteDebugAst({
							payload,
							state: debugState,
						})
					: undefined;
				return executeWithQueryTrace(
					tracer,
					{
						ast: debugAst,
						endpoint: "/gateway/delete",
						operation: "delete",
						options: mergedOptions,
						payload,
						sql,
						table: resolvedTableName,
					},
					async () => {
						const response = await client.deleteGateway<Row | null>(
							payload,
							mergedOptions,
						);
						return formatGatewayResult(response, {
							operation: "delete",
							table: resolvedTableName,
						});
					},
					callsite,
				);
			};
			return createMutationQuery<Row | null>(
				executeDelete,
				null,
				tracer,
				mutationCallsite,
				mutationExecutable("delete"),
				(columns, selectOptions) => {
					const executionState = snapshotState();
					const filters = executionState.conditions.length
						? [...executionState.conditions]
						: undefined;
					const mergedOptions = mergeOptions(options, selectOptions);
					const resolvedTableName = resolveTableNameForCall(
						tableName,
						mergedOptions?.schema,
					);
					const payload: AthenaDeletePayload = {
						conditions: filters,
						resource_id: resourceId,
						table_name: resolvedTableName,
					};
					if (executionState.order) {
						payload.sort_by = executionState.order;
					}
					if (executionState.limit !== undefined) {
						payload.limit = executionState.limit;
					}
					if (executionState.offset !== undefined) {
						payload.offset = executionState.offset;
					}
					if (executionState.currentPage !== undefined) {
						payload.current_page = executionState.currentPage;
					}
					if (executionState.pageSize !== undefined) {
						payload.page_size = executionState.pageSize;
					}
					if (executionState.totalPages !== undefined) {
						payload.total_pages = executionState.totalPages;
					}
					if (columns) {
						payload.columns = columns;
					}
					return { kind: "delete", payload };
				},
			);
		},
		async findMany<const TSelect extends AthenaSelectShape>(
			options: AthenaFindManyOptions<Row, TSelect> & {
				select: AthenaValidatedSelectShape<Row, TSelect>;
			},
		) {
			const columns = compileSelectShape(options.select);
			const baseState = snapshotState();
			const executionState = snapshotState();
			const callsite = captureTraceCallsite(tracer);
			if (options.orderBy !== undefined) {
				executionState.order = compileOrderBy<Row>(options.orderBy);
			}
			if (options.limit !== undefined) {
				executionState.limit = options.limit;
			}
			const nestedQueryModifiers = selectShapeHasNestedQueryModifiers(
				options.select,
			);
			const schemaQualifiedRelation = selectShapeUsesRelationSchema(
				options.select,
			);
			const useFindManyAst =
				Boolean(behavior?.findManyAst) &&
				canUseFindManyAstTransport(baseState) &&
				!findManyAstWhereRequiresLegacyTransport(options.where) &&
				(!schemaQualifiedRelation ||
					Boolean(behavior?.findManyAstRelationSchema));
			if (!useFindManyAst) {
				const compiledWhere = compileWhere(options.where);
				if (compiledWhere?.length) {
					executionState.conditions.push(...compiledWhere);
				}
			}
			if (!useFindManyAst && nestedQueryModifiers) {
				throw new Error(
					"ATHENA_QUERY_UNSUPPORTED_CAPABILITY: nested relation where/order/limit require the findMany AST path",
				);
			}
			if (useFindManyAst) {
				const resolvedTableName = resolveTableNameForCall(tableName, undefined);
				const payload: AthenaFindManyAstPayload<Row, TSelect> = {
					select: options.select,
					table_name: resolvedTableName,
				};
				if (options.where !== undefined) {
					payload.where = normalizeFindManyAstWhere(options.where);
				}
				const astOrder = toFindManyAstOrder<Row>(executionState.order);
				if (astOrder !== undefined) {
					payload.orderBy = astOrder;
				}
				if (executionState.limit !== undefined) {
					payload.limit = executionState.limit;
				}
				const sql = buildDebugSelectQuery({
					columns,
					conditions: executionState.conditions,
					limit: executionState.limit,
					order: executionState.order,
					tableName: resolvedTableName,
				});
				const debugAst = debugAstEnabled
					? buildFindManyDirectDebugAst({
							baseState,
							compiledColumns: columns,
							executionState,
							options,
							payload,
							tableName: resolvedTableName,
						})
					: undefined;
				return executeRead(behavior, () =>
					executeWithQueryTrace(
						tracer,
						{
							ast: debugAst,
							endpoint: "/gateway/fetch",
							operation: "select",
							payload,
							sql,
							table: resolvedTableName,
						},
						async () => {
							const response =
								await client.fetchGateway<
									AthenaFindManyResult<Row, TSelect, TContext>[]
								>(payload);
							return formatGatewayResult(response, {
								operation: "select",
								table: resolvedTableName,
							});
						},
						callsite,
					),
				);
			}
			return runSelect<AthenaFindManyResult<Row, TSelect, TContext>[]>(
				columns,
				undefined,
				executionState,
				callsite,
				debugAstEnabled
					? ({
							tableName: resolvedTableName,
							executionState: tracedState,
							plan,
						}) =>
							buildFindManyCompiledDebugAst({
								baseState,
								compiledColumns: columns,
								executionState: tracedState,
								options,
								plan,
								tableName: resolvedTableName,
							})
					: undefined,
			);
		},
		insert(values: Insert | Insert[], options?: AthenaGatewayCallOptions) {
			const insertChangedFields = collectChangedFields(values);
			const mutationCallsite = captureTraceCallsite(tracer);
			if (Array.isArray(values)) {
				const executeInsertMany = async (
					columns?: string | string[],
					selectOptions?: AthenaGatewayCallOptions,
					callsite?: AthenaQueryTraceCallsite | null,
				) => {
					const mergedOptions = mergeOptions(options, selectOptions);
					const resolvedTableName = resolveTableNameForCall(
						tableName,
						mergedOptions?.schema,
					);
					const payload: AthenaInsertPayload = {
						insert_body: asAthenaJsonObjectArray(values),
						table_name: resolvedTableName,
					};
					if (columns) {
						payload.columns = columns;
					}
					if (mergedOptions?.count) {
						payload.count = mergedOptions.count;
					}
					if (mergedOptions?.head) {
						payload.head = mergedOptions.head;
					}
					if (mergedOptions?.defaultToNull !== undefined) {
						payload.default_to_null = mergedOptions.defaultToNull;
					}
					const sql = buildInsertDebugSql(payload);
					const debugAst = debugAstEnabled
						? buildInsertDebugAst(payload)
						: undefined;
					return executeWithQueryTrace(
						tracer,
						{
							ast: debugAst,
							endpoint: "/gateway/insert",
							operation: "insert",
							options: mergedOptions,
							payload,
							sql,
							table: resolvedTableName,
						},
						async () => {
							const response = await client.insertGateway<Row[]>(
								payload,
								mergedOptions,
							);
							return formatGatewayResult(response, {
								operation: "insert",
								table: resolvedTableName,
							});
						},
						callsite,
					);
				};
				return createMutationQuery<Row[]>(
					executeInsertMany,
					DEFAULT_COLUMNS,
					tracer,
					mutationCallsite,
					mutationExecutable("insert", insertChangedFields),
					(columns, selectOptions) => {
						const mergedOptions = mergeOptions(options, selectOptions);
						const resolvedTableName = resolveTableNameForCall(
							tableName,
							mergedOptions?.schema,
						);
						const payload: AthenaInsertPayload = {
							insert_body: asAthenaJsonObjectArray(values),
							table_name: resolvedTableName,
						};
						const payloadColumns = normalizeSelectColumnsInput(columns);
						if (payloadColumns) {
							payload.columns = payloadColumns;
						}
						if (mergedOptions?.count) {
							payload.count = mergedOptions.count;
						}
						if (mergedOptions?.head) {
							payload.head = mergedOptions.head;
						}
						if (mergedOptions?.defaultToNull !== undefined) {
							payload.default_to_null = mergedOptions.defaultToNull;
						}
						return { kind: "insert", payload };
					},
				);
			}
			const executeInsertOne = async (
				columns?: string | string[],
				selectOptions?: AthenaGatewayCallOptions,
				callsite?: AthenaQueryTraceCallsite | null,
			) => {
				const mergedOptions = mergeOptions(options, selectOptions);
				const resolvedTableName = resolveTableNameForCall(
					tableName,
					mergedOptions?.schema,
				);
				const payload: AthenaInsertPayload = {
					insert_body: asAthenaJsonObject(values),
					table_name: resolvedTableName,
				};
				if (columns) {
					payload.columns = columns;
				}
				if (mergedOptions?.count) {
					payload.count = mergedOptions.count;
				}
				if (mergedOptions?.head) {
					payload.head = mergedOptions.head;
				}
				if (mergedOptions?.defaultToNull !== undefined) {
					payload.default_to_null = mergedOptions.defaultToNull;
				}
				const sql = buildInsertDebugSql(payload);
				const debugAst = debugAstEnabled
					? buildInsertDebugAst(payload)
					: undefined;
				return executeWithQueryTrace(
					tracer,
					{
						ast: debugAst,
						endpoint: "/gateway/insert",
						operation: "insert",
						options: mergedOptions,
						payload,
						sql,
						table: resolvedTableName,
					},
					async () => {
						const response = await client.insertGateway<Row>(
							payload,
							mergedOptions,
						);
						return formatGatewayResult(response, {
							operation: "insert",
							table: resolvedTableName,
						});
					},
					callsite,
				);
			};
			return createMutationQuery<Row>(
				executeInsertOne,
				DEFAULT_COLUMNS,
				tracer,
				mutationCallsite,
				mutationExecutable("insert", insertChangedFields),
				(columns, selectOptions) => {
					const mergedOptions = mergeOptions(options, selectOptions);
					const resolvedTableName = resolveTableNameForCall(
						tableName,
						mergedOptions?.schema,
					);
					const payload: AthenaInsertPayload = {
						insert_body: asAthenaJsonObject(values),
						table_name: resolvedTableName,
					};
					if (columns) {
						payload.columns = columns;
					}
					if (mergedOptions?.count) {
						payload.count = mergedOptions.count;
					}
					if (mergedOptions?.head) {
						payload.head = mergedOptions.head;
					}
					if (mergedOptions?.defaultToNull !== undefined) {
						payload.default_to_null = mergedOptions.defaultToNull;
					}
					return { kind: "insert", payload };
				},
			);
		},
		async maybeSingle<T = Row>(
			columns?: AthenaSelectInput,
			options?: AthenaGatewayCallOptions,
		) {
			const response = await runSelect<T[]>(
				columns ?? DEFAULT_COLUMNS,
				options,
				snapshotState(),
				captureTraceCallsite(tracer),
			);
			return applyCardinality(response, "maybeSingle");
		},
		model: state.model,
		reset() {
			state.conditions = [];
			state.limit = undefined;
			state.offset = undefined;
			state.order = undefined;
			state.currentPage = undefined;
			state.pageSize = undefined;
			state.totalPages = undefined;
			return builder;
		},
		select<T = Row>(
			columns: AthenaSelectInput = DEFAULT_COLUMNS,
			options?: AthenaGatewayCallOptions,
		) {
			return createSelectChain<T>(
				columns,
				options,
				captureTraceCallsite(tracer),
			);
		},
		async single<T = Row>(
			columns?: AthenaSelectInput,
			options?: AthenaGatewayCallOptions,
		) {
			const response = await runSelect<T[]>(
				columns ?? DEFAULT_COLUMNS,
				options,
				snapshotState(),
				captureTraceCallsite(tracer),
			);
			return applyCardinality(response, "single");
		},
		update(values: Update, options?: AthenaGatewayCallOptions) {
			const updateChangedFields = collectChangedFields(values);
			const mutationCallsite = captureTraceCallsite(tracer);
			const executeUpdate = async (
				columns?: string | string[],
				selectOptions?: AthenaGatewayCallOptions,
				callsite?: AthenaQueryTraceCallsite | null,
			) => {
				const executionState = snapshotState();
				const filters = executionState.conditions.length
					? [...executionState.conditions]
					: undefined;
				const mergedOptions = mergeOptions(options, selectOptions);
				const resolvedTableName = resolveTableNameForCall(
					tableName,
					mergedOptions?.schema,
				);
				const payload: AthenaUpdatePayload = {
					conditions: filters,
					strip_nulls: mergedOptions?.stripNulls ?? true,
					table_name: resolvedTableName,
					update_body: asAthenaJsonObject(values),
				};
				if (executionState.order) {
					payload.sort_by = executionState.order;
				}
				if (executionState.limit !== undefined) {
					payload.limit = executionState.limit;
				}
				if (executionState.offset !== undefined) {
					payload.offset = executionState.offset;
				}
				if (executionState.currentPage !== undefined) {
					payload.current_page = executionState.currentPage;
				}
				if (executionState.pageSize !== undefined) {
					payload.page_size = executionState.pageSize;
				}
				if (executionState.totalPages !== undefined) {
					payload.total_pages = executionState.totalPages;
				}
				if (columns) {
					payload.columns = columns;
				}
				const sql = buildUpdateDebugSql(payload);
				const debugAst = debugAstEnabled
					? buildUpdateDebugAst({
							payload,
							state: executionState,
						})
					: undefined;
				return executeWithQueryTrace(
					tracer,
					{
						ast: debugAst,
						endpoint: "/gateway/update",
						operation: "update",
						options: mergedOptions,
						payload,
						sql,
						table: resolvedTableName,
					},
					async () => {
						const response = await client.updateGateway<Row[]>(
							payload,
							mergedOptions,
						);
						return formatGatewayResult(response, {
							operation: "update",
							table: resolvedTableName,
						});
					},
					callsite,
				);
			};
			const mutation = createMutationQuery<Row[]>(
				executeUpdate,
				null,
				tracer,
				mutationCallsite,
				mutationExecutable("update", updateChangedFields),
				(columns, selectOptions) => {
					const executionState = snapshotState();
					const filters = executionState.conditions.length
						? [...executionState.conditions]
						: undefined;
					const mergedOptions = mergeOptions(options, selectOptions);
					const resolvedTableName = resolveTableNameForCall(
						tableName,
						mergedOptions?.schema,
					);
					const payload: AthenaUpdatePayload = {
						conditions: filters,
						strip_nulls: mergedOptions?.stripNulls ?? true,
						table_name: resolvedTableName,
						update_body: asAthenaJsonObject(values),
					};
					if (executionState.order) {
						payload.sort_by = executionState.order;
					}
					if (executionState.limit !== undefined) {
						payload.limit = executionState.limit;
					}
					if (executionState.offset !== undefined) {
						payload.offset = executionState.offset;
					}
					if (executionState.currentPage !== undefined) {
						payload.current_page = executionState.currentPage;
					}
					if (executionState.pageSize !== undefined) {
						payload.page_size = executionState.pageSize;
					}
					if (executionState.totalPages !== undefined) {
						payload.total_pages = executionState.totalPages;
					}
					if (columns) {
						payload.columns = columns;
					}
					return { kind: "update", payload };
				},
			);
			const updateChain = {} as UpdateChain<Row>;
			const filterMethods = createFilterMethods<UpdateChain<Row>, Row>(
				state,
				addCondition,
				updateChain,
			);
			Object.assign(updateChain, filterMethods, mutation);
			return updateChain;
		},
		upsert(
			values: Insert | Insert[],
			options?: AthenaGatewayCallOptions & {
				updateBody?: Update;
				onConflict?: string | string[];
			},
		) {
			const upsertChangedFields = collectChangedFields(values);
			const mutationCallsite = captureTraceCallsite(tracer);
			if (Array.isArray(values)) {
				const executeUpsertMany = async (
					columns?: string | string[],
					selectOptions?: AthenaGatewayCallOptions,
					callsite?: AthenaQueryTraceCallsite | null,
				) => {
					const mergedOptions = mergeOptions(options, selectOptions);
					const resolvedTableName = resolveTableNameForCall(
						tableName,
						mergedOptions?.schema,
					);
					const payload: AthenaInsertPayload = {
						insert_body: asAthenaJsonObjectArray(values),
						table_name: resolvedTableName,
						update_body: options?.updateBody
							? asAthenaJsonObject(options.updateBody)
							: undefined,
					};
					if (columns) {
						payload.columns = columns;
					}
					if (options?.onConflict) {
						payload.on_conflict = options.onConflict;
					}
					if (mergedOptions?.count) {
						payload.count = mergedOptions.count;
					}
					if (mergedOptions?.head) {
						payload.head = mergedOptions.head;
					}
					if (mergedOptions?.defaultToNull !== undefined) {
						payload.default_to_null = mergedOptions.defaultToNull;
					}
					const sql = buildInsertDebugSql(payload);
					const debugAst = debugAstEnabled
						? buildUpsertDebugAst(payload)
						: undefined;
					return executeWithQueryTrace(
						tracer,
						{
							ast: debugAst,
							endpoint: "/gateway/insert",
							operation: "upsert",
							semanticOperation: "upsert",
							options: mergedOptions,
							payload,
							sql,
							table: resolvedTableName,
						},
						async () => {
							const response = await client.insertGateway<Row[]>(
								payload,
								mergedOptions,
							);
							return formatGatewayResult(response, {
								operation: "insert",
								table: resolvedTableName,
							});
						},
						callsite,
					);
				};
				return createMutationQuery<Row[]>(
					executeUpsertMany,
					DEFAULT_COLUMNS,
					tracer,
					mutationCallsite,
					mutationExecutable("upsert", upsertChangedFields),
					(columns, selectOptions) => {
						const mergedOptions = mergeOptions(options, selectOptions);
						const resolvedTableName = resolveTableNameForCall(
							tableName,
							mergedOptions?.schema,
						);
						const payload: AthenaInsertPayload = {
							insert_body: asAthenaJsonObjectArray(values as Insert[]),
							table_name: resolvedTableName,
							update_body: options?.updateBody
								? asAthenaJsonObject(options.updateBody)
								: undefined,
						};
						const payloadColumns = normalizeSelectColumnsInput(columns);
						if (payloadColumns) {
							payload.columns = payloadColumns;
						}
						if (options?.onConflict) {
							payload.on_conflict = options.onConflict;
						}
						return { kind: "insert", payload };
					},
				);
			}
			const executeUpsertOne = async (
				columns?: string | string[],
				selectOptions?: AthenaGatewayCallOptions,
				callsite?: AthenaQueryTraceCallsite | null,
			) => {
				const mergedOptions = mergeOptions(options, selectOptions);
				const resolvedTableName = resolveTableNameForCall(
					tableName,
					mergedOptions?.schema,
				);
				const payload: AthenaInsertPayload = {
					insert_body: asAthenaJsonObject(values),
					table_name: resolvedTableName,
					update_body: options?.updateBody
						? asAthenaJsonObject(options.updateBody)
						: undefined,
				};
				if (columns) {
					payload.columns = columns;
				}
				if (options?.onConflict) {
					payload.on_conflict = options.onConflict;
				}
				if (mergedOptions?.count) {
					payload.count = mergedOptions.count;
				}
				if (mergedOptions?.head) {
					payload.head = mergedOptions.head;
				}
				if (mergedOptions?.defaultToNull !== undefined) {
					payload.default_to_null = mergedOptions.defaultToNull;
				}
				const sql = buildInsertDebugSql(payload);
				const debugAst = debugAstEnabled
					? buildUpsertDebugAst(payload)
					: undefined;
				return executeWithQueryTrace(
					tracer,
					{
						ast: debugAst,
						endpoint: "/gateway/insert",
						operation: "upsert",
						semanticOperation: "upsert",
						options: mergedOptions,
						payload,
						sql,
						table: resolvedTableName,
					},
					async () => {
						const response = await client.insertGateway<Row>(
							payload,
							mergedOptions,
						);
						return formatGatewayResult(response, {
							operation: "insert",
							table: resolvedTableName,
						});
					},
					callsite,
				);
			};
			return createMutationQuery<Row>(
				executeUpsertOne,
				DEFAULT_COLUMNS,
				tracer,
				mutationCallsite,
				mutationExecutable("upsert", upsertChangedFields),
				(columns, selectOptions) => {
					const mergedOptions = mergeOptions(options, selectOptions);
					const resolvedTableName = resolveTableNameForCall(
						tableName,
						mergedOptions?.schema,
					);
					const payload: AthenaInsertPayload = {
						insert_body: asAthenaJsonObject(values),
						table_name: resolvedTableName,
						update_body: options?.updateBody
							? asAthenaJsonObject(options.updateBody)
							: undefined,
					};
					if (columns) {
						payload.columns = columns;
					}
					if (options?.onConflict) {
						payload.on_conflict = options.onConflict;
					}
					return { kind: "insert", payload };
				},
			);
		},
	});

	return builder;
}

export function createQueryBuilder(
	client: ReturnType<typeof createAthenaGatewayClient>,
	formatGatewayResult: AthenaResultFormatter,
	behavior?: InternalClientBehaviorOptions,
	tracer?: AthenaQueryTracer,
	deprecationOwner?: object,
) {
	const debugAstEnabled = Boolean(behavior?.debugAst);
	// Legacy root query() historically forwarded multi-statement scripts to the
	// gateway (migration/seed). Keep that behavior; only explicit admin.query rejects.
	const adminQuery = createAdminQuery({
		allowMultiStatement: true,
		client,
		formatGatewayResult,
	});
	/**
	 * Executes raw SQL through Athena's compatibility query surface.
	 *
	 * @deprecated Prefer `athena.admin.query()` with explicit `operation`
	 * and `expectedShape`.
	 */
	return async function query<Row = unknown>(
		sql: string,
		options?: AthenaGatewayCallOptions,
	): Promise<AthenaResult<Row[]>> {
		if (deprecationOwner) {
			maybeWarnRawQueryDeprecated(
				deprecationOwner,
				behavior?.rawQueryDiagnostics,
			);
		}
		const normalizedQuery = sql.trim();
		if (!normalizedQuery) {
			throw new Error("query requires a non-empty string");
		}
		const operation = classifyRawSqlOperation(normalizedQuery);
		const expectedShape = defaultExpectedShapeForOperation(operation);
		const params = options?.params;
		const payload = {
			query: normalizedQuery,
			...(Array.isArray(params) ? { params } : {}),
			expectedShape,
			operation,
		};
		const callsite = captureTraceCallsite(tracer);
		return executeRead(behavior, () =>
			executeWithQueryTrace(
				tracer,
				{
					ast: debugAstEnabled
						? buildRawQueryDebugAst(normalizedQuery)
						: undefined,
					endpoint: "/gateway/query",
					operation: "query",
					options,
					payload,
					sql: normalizedQuery,
				},
				async () => {
					const result = await adminQuery<Row[]>(
						{
							sql: normalizedQuery,
							...(Array.isArray(params) ? { params } : {}),
							expectedShape: "rows",
							operation,
						},
						options,
					);
					// Preserve legacy AthenaResult shape (no required metadata on root query).
					const { metadata: _metadata, ...legacy } = result;
					void _metadata;
					return legacy;
				},
				callsite,
			),
		);
	};
}
