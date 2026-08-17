import chalk from "chalk";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { AthenaConditionValue } from "../../src/gateway/types.ts";
import type {
  AthenaClient,
  AthenaJsonObject,
  AthenaResult,
  AthenaRpcFilter,
} from "../../src/index.js";
import { createAthenaBrowserClient } from "../../src/next/client.ts";
import { buildSdkSurfaceReport } from "./sdk-surface.ts";

type Logger = Pick<Console, "log" | "warn" | "error">;

interface DemoProduct {
  id: string;
  name: string;
  price: number;
}

function rpcScalarFilterValue(
  value: AthenaRpcFilter["value"] | undefined
): AthenaConditionValue | null {
  if (value === undefined) {
    return null;
  }
  return value as AthenaConditionValue;
}

type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "ATHENA_GATEWAY_ERROR"
  | "INTERNAL_SERVER_ERROR";

class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class AthenaGatewayResultError extends ApiError {
  constructor(operation: string, result: AthenaResult<unknown>) {
    super(
      result.status >= 400 ? result.status : 502,
      "ATHENA_GATEWAY_ERROR",
      typeof result.error === "string"
        ? result.error
        : (result.error?.message ?? `Athena gateway ${operation} failed`),
      {
        gatewayErrorDetails: result.errorDetails ?? null,
        gatewayStatus: result.status,
      }
    );
    this.name = "AthenaGatewayResultError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNonNegativeInteger(
  value: string | string[] | undefined,
  fieldName: string,
  fallback: number
): number {
  if (value === undefined) {
    return fallback;
  }
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${fieldName} must be a non-negative integer`,
      {
        field: fieldName,
        received: normalized,
      }
    );
  }
  return parsed;
}

function parsePositiveNumber(value: unknown, fieldName: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${fieldName} must be a positive number`,
      {
        field: fieldName,
        received: value,
      }
    );
  }
  return parsed;
}

function assertNonEmptyParam(value: string, fieldName: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ApiError(400, "VALIDATION_ERROR", `${fieldName} is required`, {
      field: fieldName,
    });
  }
  return normalized;
}

function assertObjectBody(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${fieldName} must be a JSON object`,
      {
        field: fieldName,
      }
    );
  }
  return value;
}

function toErrorResponse(error: unknown, responseTimeMs: number) {
  if (error instanceof ApiError) {
    return {
      body: {
        error: {
          code: error.code,
          details: error.details ?? null,
          message: error.message,
        },
        responseTimeMs,
      },
      statusCode: error.statusCode,
    };
  }

  return {
    body: {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        details: null,
        message:
          error instanceof Error ? error.message : "Unexpected server error",
      },
      responseTimeMs,
    },
    statusCode: 500,
  };
}

function methodColor(method: string) {
  if (method === "GET") {
    return chalk.green;
  }
  if (method === "POST") {
    return chalk.blue;
  }
  if (method === "PATCH") {
    return chalk.yellow;
  }
  if (method === "DELETE") {
    return chalk.red;
  }
  return chalk.gray;
}

function statusColor(status: number) {
  if (status >= 200 && status < 300) {
    return chalk.green;
  }
  if (status >= 400) {
    return chalk.red;
  }
  return chalk.yellow;
}

function speedColor(responseTimeMs: number) {
  if (responseTimeMs < 100) {
    return chalk.green;
  }
  if (responseTimeMs < 500) {
    return chalk.yellow;
  }
  return chalk.red;
}

export interface AthenaTestSdkServerConfig {
  athenaApiKey: string;
  athenaClient: string;
  athenaUrl: string;
}

export interface AthenaTestSdkServerOptions {
  athenaClient?: AthenaClient;
  config: AthenaTestSdkServerConfig;
  logger?: Logger;
}

export class AthenaTestSdkServer {
  private readonly app: Express;
  private readonly logger: Logger;
  private readonly athenaClient: AthenaClient;
  private readonly demoProducts: DemoProduct[] = [
    {
      id: "demo-1",
      name: "Starter Product",
      price: 49,
    },
    {
      id: "demo-2",
      name: "Athena Mug",
      price: 19,
    },
  ];
  private demoProductSequence = 2;

  constructor(options: AthenaTestSdkServerOptions) {
    this.logger = options.logger ?? console;
    // Explicit url/key construction via the Next browser façade (ADR 0014).
    // Long-lived Express process owns the singleton; request-scoped Next
    // construction uses createAthenaServerClient instead.
    // Cast through unknown: createAthenaBrowserClient generics can hit TS2589.
    const buildBrowserClient =
      createAthenaBrowserClient as unknown as (config: {
        backend: { type: "athena" };
        client?: string | null;
        key: string;
        url: string;
      }) => AthenaClient;
    this.athenaClient =
      options.athenaClient ??
      buildBrowserClient({
        backend: { type: "athena" },
        client: options.config.athenaClient,
        key: options.config.athenaApiKey,
        url: options.config.athenaUrl,
      });

    this.app = express();
    this.registerMiddleware();
    this.registerRoutes();
    this.registerErrorMiddleware();
  }

  get expressApp() {
    return this.app;
  }

  private registerMiddleware() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      const startedAt = performance.now();
      res.locals.startedAt = startedAt;
      res.on("finish", () => {
        const responseTimeMs = Math.round(performance.now() - startedAt);
        this.logger.log(
          `${methodColor(req.method)(req.method.padEnd(6))} ${chalk.cyan(req.path)} ${statusColor(res.statusCode)(String(res.statusCode))} ${speedColor(responseTimeMs)(`${responseTimeMs}ms`)}`
        );
      });
      next();
    });
  }

  private registerRoutes() {
    this.app.get("/health", (_req, res) => {
      this.sendSuccess(res, 200, { ok: true, sdk: "athena-js" });
    });

    this.app.get("/demo/products", (_req, res) => {
      this.sendSuccess(res, 200, {
        data: this.demoProducts,
      });
    });

    this.app.post(
      "/demo/products",
      this.wrap(async (req, res) => {
        const body = assertObjectBody(req.body, "request body");
        const name = body.name;
        if (typeof name !== "string" || !name.trim()) {
          throw new ApiError(400, "VALIDATION_ERROR", "name is required", {
            field: "name",
            received: name,
          });
        }

        const created: DemoProduct = {
          id: `demo-${++this.demoProductSequence}`,
          name: name.trim(),
          price: parsePositiveNumber(body.price, "price"),
        };
        this.demoProducts.push(created);
        this.sendSuccess(res, 201, { data: created });
      })
    );

    this.app.get(
      "/table/:name",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const limit = parseNonNegativeInteger(
          req.query.limit as string | undefined,
          "limit",
          10
        );
        const offset = parseNonNegativeInteger(
          req.query.offset as string | undefined,
          "offset",
          0
        );

        const result = await this.athenaClient
          .from(tableName)
          .limit(limit)
          .offset(offset)
          .select();
        const data = this.unwrapResult("select rows", result);
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.get(
      "/table/:name/by/:column/:value",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const column = assertNonEmptyParam(req.params.column, "column");
        const value = req.params.value;

        const result = await this.athenaClient
          .from(tableName)
          .eq(column, value)
          .maybeSingle();
        const data = this.unwrapResult("select single row", result);
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.post(
      "/table/:name",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        if (!(isRecord(req.body) || Array.isArray(req.body))) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "request body must be an object or array"
          );
        }

        const table =
          this.athenaClient.from<Record<string, unknown>>(tableName);
        const result = Array.isArray(req.body)
          ? await table.insert(req.body as Record<string, unknown>[]).select()
          : await table.insert(req.body).select();
        const data = this.unwrapResult(
          "insert rows",
          result as AthenaResult<unknown>
        );
        this.sendSuccess(res, 201, { data });
      })
    );

    this.app.patch(
      "/table/:name/by/:column/:value",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const column = assertNonEmptyParam(req.params.column, "column");
        const value = req.params.value;
        const body = assertObjectBody(req.body, "request body");

        const result = await this.athenaClient
          .from(tableName)
          .eq(column, value)
          .update(body)
          .select();
        const data = this.unwrapResult("update rows", result);
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.delete(
      "/table/:name/:resourceId",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const resourceId = assertNonEmptyParam(
          req.params.resourceId,
          "resourceId"
        );

        const result = await this.athenaClient
          .from(tableName)
          .delete({ resourceId });
        const data = this.unwrapResult("delete rows", result);
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.post(
      "/rpc/:functionName",
      this.wrap(async (req, res) => {
        const functionName = assertNonEmptyParam(
          req.params.functionName,
          "functionName"
        );
        const body = req.body === undefined ? {} : req.body;
        if (!isRecord(body)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "request body must be a JSON object"
          );
        }

        const args = isRecord(body.args)
          ? (body.args as AthenaJsonObject)
          : undefined;
        const schema =
          typeof body.schema === "string" ? body.schema : undefined;
        const select =
          typeof body.select === "string" || Array.isArray(body.select)
            ? body.select
            : undefined;
        const count =
          body.count === "exact" ||
          body.count === "planned" ||
          body.count === "estimated"
            ? body.count
            : undefined;
        const head = body.head === true;
        const get = body.get === true;
        const limit =
          body.limit === undefined
            ? undefined
            : parseNonNegativeInteger(String(body.limit), "limit", 0);
        const offset =
          body.offset === undefined
            ? undefined
            : parseNonNegativeInteger(String(body.offset), "offset", 0);
        const order =
          isRecord(body.order) && typeof body.order.column === "string"
            ? {
                ascending: body.order.ascending !== false,
                column: body.order.column,
              }
            : undefined;
        const filters = Array.isArray(body.filters)
          ? (body.filters as AthenaRpcFilter[])
          : [];

        let query = this.athenaClient.rpc(functionName, args, {
          count,
          schema,
        });
        for (const filter of filters) {
          if (
            !filter ||
            typeof filter.column !== "string" ||
            typeof filter.operator !== "string"
          ) {
            throw new ApiError(
              400,
              "VALIDATION_ERROR",
              "invalid rpc filter shape"
            );
          }
          query = this.applyRpcFilter(query, filter);
        }

        if (order) {
          query = query.order(order.column, { ascending: order.ascending });
        }
        if (typeof limit === "number") {
          query = query.limit(limit);
        }
        if (typeof offset === "number") {
          query = query.offset(offset);
        }

        const result = await query.select(select, { count, get, head, schema });
        const data = this.unwrapResult("execute rpc", result);
        this.sendSuccess(res, 200, { count: result.count ?? null, data });
      })
    );

    this.app.put(
      "/table/:name/upsert",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        if (!(isRecord(req.body) || Array.isArray(req.body))) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "request body must be an object or array"
          );
        }

        const table =
          this.athenaClient.from<Record<string, unknown>>(tableName);
        const result = Array.isArray(req.body)
          ? await table.upsert(req.body as Record<string, unknown>[]).select()
          : await table.upsert(req.body).select();
        const data = this.unwrapResult(
          "upsert rows",
          result as AthenaResult<unknown>
        );
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.post(
      "/table/:name/find-many",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const body = assertObjectBody(req.body, "request body");
        if (!isRecord(body.select)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "select must be an object shape for findMany",
            { field: "select" }
          );
        }

        const findManyOptions: {
          select: Record<string, true | Record<string, unknown>>;
          limit?: number;
        } = {
          select: body.select as Record<string, true | Record<string, unknown>>,
        };
        if (typeof body.limit === "number") {
          findManyOptions.limit = body.limit;
        }

        const result = await this.athenaClient
          .from(tableName)
          .findMany(findManyOptions as never);
        const data = this.unwrapResult("findMany", result);
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.post(
      "/query",
      this.wrap(async (req, res) => {
        const body = assertObjectBody(req.body, "request body");
        const sql = body.sql;
        if (typeof sql !== "string" || !sql.trim()) {
          throw new ApiError(400, "VALIDATION_ERROR", "sql is required", {
            field: "sql",
            received: sql,
          });
        }

        const result = await this.athenaClient.query(sql);
        const data = this.unwrapResult("raw query", result);
        this.sendSuccess(res, 200, { data });
      })
    );

    this.app.get(
      "/sdk/surface",
      this.wrap(async (_req, res) => {
        // Inventory every documented `athena.*` method from
        // docs/complete-method-reference.md against the live client (no gateway I/O).
        const report = buildSdkSurfaceReport(this.athenaClient);
        this.sendSuccess(res, 200, { data: report });
      })
    );

    /**
     * Generic table select that applies every filter operator the fluent
     * builder supports. Body:
     * `{ select?, limit?, offset?, order?, filters: [{ column, operator, value, cast? }] }`
     */
    this.app.post(
      "/table/:name/select",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const body = req.body === undefined ? {} : req.body;
        if (!isRecord(body)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "request body must be a JSON object"
          );
        }

        let query = this.athenaClient.from(tableName) as ReturnType<
          AthenaClient["from"]
        >;
        const filters = Array.isArray(body.filters)
          ? (body.filters as AthenaRpcFilter[])
          : [];
        for (const filter of filters) {
          if (
            !filter ||
            typeof filter.column !== "string" ||
            typeof filter.operator !== "string"
          ) {
            throw new ApiError(
              400,
              "VALIDATION_ERROR",
              "invalid table filter shape"
            );
          }
          query = this.applyTableFilter(query, filter);
        }

        if (isRecord(body.order) && typeof body.order.column === "string") {
          query = query.order(body.order.column, {
            ascending: body.order.ascending !== false,
          });
        }
        if (body.limit !== undefined) {
          query = query.limit(
            parseNonNegativeInteger(String(body.limit), "limit", 0)
          );
        }
        if (body.offset !== undefined) {
          query = query.offset(
            parseNonNegativeInteger(String(body.offset), "offset", 0)
          );
        }

        const select =
          typeof body.select === "string" || Array.isArray(body.select)
            ? body.select
            : undefined;
        const result = await query.select(select as never);
        const data = this.unwrapResult("select with filters", result);
        this.sendSuccess(res, 200, { data });
      })
    );
  }

  private registerErrorMiddleware() {
    this.app.use(
      (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const responseTimeMs = Math.round(
          performance.now() -
            (typeof res.locals.startedAt === "number"
              ? res.locals.startedAt
              : performance.now())
        );
        const { statusCode, body } = toErrorResponse(error, responseTimeMs);
        res.status(statusCode).json(body);
      }
    );
  }

  private wrap(handler: (req: Request, res: Response) => Promise<void>) {
    return (req: Request, res: Response, next: NextFunction) => {
      handler(req, res).catch(next);
    };
  }

  private unwrapResult<T>(operation: string, result: AthenaResult<T>) {
    if (result.error) {
      throw new AthenaGatewayResultError(
        operation,
        result as AthenaResult<unknown>
      );
    }
    return result.data ?? null;
  }

  private sendSuccess(
    res: Response,
    statusCode: number,
    body: Record<string, unknown>
  ) {
    const responseTimeMs = Math.round(
      performance.now() -
        (typeof res.locals.startedAt === "number"
          ? res.locals.startedAt
          : performance.now())
    );
    res.status(statusCode).json({
      ...body,
      responseTimeMs,
    });
  }

  private applyRpcFilter(
    query: ReturnType<AthenaClient["rpc"]>,
    filter: AthenaRpcFilter
  ) {
    const scalar = rpcScalarFilterValue(filter.value);
    switch (filter.operator) {
      case "eq":
        return query.eq(filter.column, scalar);
      case "neq":
        return query.neq(filter.column, scalar);
      case "gt":
        return query.gt(filter.column, scalar);
      case "gte":
        return query.gte(filter.column, scalar);
      case "lt":
        return query.lt(filter.column, scalar);
      case "lte":
        return query.lte(filter.column, scalar);
      case "like":
        return query.like(filter.column, scalar);
      case "ilike":
        return query.ilike(filter.column, scalar);
      case "is":
        return query.is(filter.column, scalar);
      case "in":
        if (!Array.isArray(filter.value)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "rpc in filter requires an array value"
          );
        }
        return query.in(filter.column, filter.value);
      default:
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `unsupported rpc filter operator: ${filter.operator}`
        );
    }
  }

  private applyTableFilter(
    query: ReturnType<AthenaClient["from"]>,
    filter: AthenaRpcFilter & { cast?: string; castType?: string }
  ): ReturnType<AthenaClient["from"]> {
    const scalar = rpcScalarFilterValue(filter.value);
    // Table fluent filters are a superset of AthenaRpcFilterOperator (RPC-only ops).
    const operator = filter.operator as string;
    switch (operator) {
      case "eq":
        return query.eq(filter.column, scalar);
      case "eqUuid":
        if (typeof filter.value !== "string") {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "eqUuid filter requires a string value"
          );
        }
        return query.eqUuid(filter.column, filter.value);
      case "eqCast": {
        const cast =
          typeof filter.cast === "string"
            ? filter.cast
            : typeof filter.castType === "string"
              ? filter.castType
              : undefined;
        if (!cast) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "eqCast filter requires cast"
          );
        }
        return query.eqCast(filter.column, scalar, cast as never);
      }
      case "neq":
        return query.neq(filter.column, scalar);
      case "gt":
        return query.gt(filter.column, scalar);
      case "gte":
        return query.gte(filter.column, scalar);
      case "lt":
        return query.lt(filter.column, scalar);
      case "lte":
        return query.lte(filter.column, scalar);
      case "like":
        return query.like(filter.column, scalar);
      case "ilike":
        return query.ilike(filter.column, scalar);
      case "is":
        return query.is(filter.column, scalar);
      case "in":
        if (!Array.isArray(filter.value)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "table in filter requires an array value"
          );
        }
        return query.in(filter.column, filter.value);
      case "contains":
        if (!Array.isArray(filter.value)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "contains filter requires an array value"
          );
        }
        return query.contains(filter.column, filter.value);
      case "containedBy":
        if (!Array.isArray(filter.value)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "containedBy filter requires an array value"
          );
        }
        return query.containedBy(filter.column, filter.value);
      case "match":
        if (!isRecord(filter.value)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "match filter requires an object value"
          );
        }
        return query.match(filter.value as never);
      case "not":
        if (
          typeof filter.value === "object" &&
          filter.value !== null &&
          !Array.isArray(filter.value) &&
          "operator" in filter.value
        ) {
          const nested = filter.value as {
            operator: string;
            value?: AthenaConditionValue;
          };
          return query.not(
            filter.column,
            nested.operator as never,
            nested.value as never
          );
        }
        return query.not(filter.column, "eq", scalar);
      case "or":
        if (typeof filter.value !== "string") {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "or filter requires a string expression value"
          );
        }
        return query.or(filter.value);
      default:
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `unsupported table filter operator: ${filter.operator}`
        );
    }
  }
}

export function createAthenaTestSdkServer(options: AthenaTestSdkServerOptions) {
  return new AthenaTestSdkServer(options);
}
