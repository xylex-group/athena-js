import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import chalk from "chalk";
import {
  createClient,
  type AthenaResult,
  type AthenaRpcFilter,
  type AthenaSdkClient,
} from "../../src/index.js";
import type { AthenaConditionValue } from "../../src/gateway/types.ts";

type Logger = Pick<Console, "log" | "warn" | "error">;

function rpcScalarFilterValue(
  value: AthenaRpcFilter["value"] | undefined,
): AthenaConditionValue | null {
  if (value === undefined) return null;
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
    details?: Record<string, unknown>,
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
      result.error ?? `Athena gateway ${operation} failed`,
      {
        gatewayStatus: result.status,
        gatewayErrorDetails: result.errorDetails ?? null,
      },
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
  fallback: number,
): number {
  if (value === undefined) return fallback;
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
      },
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
      },
    );
  }
  return value;
}

function toErrorResponse(error: unknown, responseTimeMs: number) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
        responseTimeMs,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Unexpected server error",
        details: null,
      },
      responseTimeMs,
    },
  };
}

function methodColor(method: string) {
  if (method === "GET") return chalk.green;
  if (method === "POST") return chalk.blue;
  if (method === "PATCH") return chalk.yellow;
  if (method === "DELETE") return chalk.red;
  return chalk.gray;
}

function statusColor(status: number) {
  if (status >= 200 && status < 300) return chalk.green;
  if (status >= 400) return chalk.red;
  return chalk.yellow;
}

function speedColor(responseTimeMs: number) {
  if (responseTimeMs < 100) return chalk.green;
  if (responseTimeMs < 500) return chalk.yellow;
  return chalk.red;
}

export interface AthenaTestSdkServerConfig {
  athenaUrl: string;
  athenaApiKey: string;
  athenaClient: string;
}

export interface AthenaTestSdkServerOptions {
  config: AthenaTestSdkServerConfig;
  logger?: Logger;
  athenaClient?: AthenaSdkClient;
}

export class AthenaTestSdkServer {
  private readonly app: Express;
  private readonly logger: Logger;
  private readonly athenaClient: AthenaSdkClient;

  constructor(options: AthenaTestSdkServerOptions) {
    this.logger = options.logger ?? console;
    this.athenaClient =
      options.athenaClient ??
      createClient(options.config.athenaUrl, options.config.athenaApiKey, {
        client: options.config.athenaClient,
        backend: { type: "athena" },
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
          `${methodColor(req.method)(req.method.padEnd(6))} ${chalk.cyan(req.path)} ${statusColor(res.statusCode)(String(res.statusCode))} ${speedColor(responseTimeMs)(`${responseTimeMs}ms`)}`,
        );
      });
      next();
    });
  }

  private registerRoutes() {
    this.app.get("/health", (_req, res) => {
      this.sendSuccess(res, 200, { ok: true, sdk: "athena-js" });
    });

    this.app.get(
      "/table/:name",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const limit = parseNonNegativeInteger(
          req.query.limit as string | undefined,
          "limit",
          10,
        );
        const offset = parseNonNegativeInteger(
          req.query.offset as string | undefined,
          "offset",
          0,
        );

        const result = await this.athenaClient
          .from(tableName)
          .limit(limit)
          .offset(offset)
          .select();
        const data = this.unwrapResult("select rows", result);
        this.sendSuccess(res, 200, { data });
      }),
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
      }),
    );

    this.app.post(
      "/table/:name",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        if (!isRecord(req.body) && !Array.isArray(req.body)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "request body must be an object or array",
          );
        }

        const result = await this.athenaClient
          .from(tableName)
          .insert(req.body)
          .select();
        const data = this.unwrapResult("insert rows", result);
        this.sendSuccess(res, 201, { data });
      }),
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
      }),
    );

    this.app.delete(
      "/table/:name/:resourceId",
      this.wrap(async (req, res) => {
        const tableName = assertNonEmptyParam(req.params.name, "name");
        const resourceId = assertNonEmptyParam(
          req.params.resourceId,
          "resourceId",
        );

        const result = await this.athenaClient
          .from(tableName)
          .delete({ resourceId });
        const data = this.unwrapResult("delete rows", result);
        this.sendSuccess(res, 200, { data });
      }),
    );

    this.app.post(
      "/rpc/:functionName",
      this.wrap(async (req, res) => {
        const functionName = assertNonEmptyParam(
          req.params.functionName,
          "functionName",
        );
        const body = req.body === undefined ? {} : req.body;
        if (!isRecord(body)) {
          throw new ApiError(
            400,
            "VALIDATION_ERROR",
            "request body must be a JSON object",
          );
        }

        const args = isRecord(body.args) ? body.args : undefined;
        const schema =
          typeof body.schema === "string" ? body.schema : undefined;
        const select =
          typeof body.select === "string" || Array.isArray(body.select)
            ? body.select
            : undefined;
      const count =
        body.count === "exact" || body.count === "planned" || body.count === "estimated"
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
                column: body.order.column,
                ascending: body.order.ascending !== false,
              }
            : undefined;
        const filters = Array.isArray(body.filters)
          ? (body.filters as AthenaRpcFilter[])
          : [];

        let query = this.athenaClient.rpc(functionName, args, {
          schema,
          count,
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
              "invalid rpc filter shape",
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

      const result = await query.select(select, { schema, count, head, get });
      const data = this.unwrapResult("execute rpc", result);
        this.sendSuccess(res, 200, { data, count: result.count ?? null });
      }),
    );
  }

  private registerErrorMiddleware() {
    this.app.use(
      (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const responseTimeMs = Math.round(
          performance.now() -
            (typeof res.locals.startedAt === "number"
              ? res.locals.startedAt
              : performance.now()),
        );
        const { statusCode, body } = toErrorResponse(error, responseTimeMs);
        res.status(statusCode).json(body);
      },
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
        result as AthenaResult<unknown>,
      );
    }
    return result.data ?? null;
  }

  private sendSuccess(
    res: Response,
    statusCode: number,
    body: Record<string, unknown>,
  ) {
    const responseTimeMs = Math.round(
      performance.now() -
        (typeof res.locals.startedAt === "number"
          ? res.locals.startedAt
          : performance.now()),
    );
    res.status(statusCode).json({
      ...body,
      responseTimeMs,
    });
  }

  private applyRpcFilter(
    query: ReturnType<AthenaSdkClient["rpc"]>,
    filter: AthenaRpcFilter,
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
            "rpc in filter requires an array value",
          );
        }
        return query.in(filter.column, filter.value);
      default:
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `unsupported rpc filter operator: ${filter.operator}`,
        );
    }
  }
}

export function createAthenaTestSdkServer(options: AthenaTestSdkServerOptions) {
  return new AthenaTestSdkServer(options);
}
