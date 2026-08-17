import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NormalizedAthenaError } from "../src/auxiliaries.ts";
import type { JsonObject, JsonValue } from "../src/contracts/v1/common.ts";
import { PaginationLimitPolicy } from "../src/contracts/v1/pagination.ts";
import {
  clampPaginationLimit,
  mapAthenaErrorCodeToTransportCode,
  mapChatMessagePageWireToSequencePage,
  mapLimitPlusOneToPage,
  mapNormalizedAthenaErrorToErrorResponse,
  mapOffsetWindowToOffsetPage,
} from "../src/mappers/index.ts";
import {
  AthenaContractParseError,
  athenaErrorResponseSchema,
  cursorPageRequestSchema,
  jsonObjectSchema,
  jsonValueSchema,
  offsetPageRequestSchema,
  offsetPageSchema,
  pageSchema,
  parseContractOrThrow,
  safeParseContract,
  sequencePageSchema,
} from "../src/runtime/index.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "contracts"
);

function readFixture(relativePath: string): unknown {
  const raw = readFileSync(join(fixturesRoot, relativePath), "utf8");
  return JSON.parse(raw) as unknown;
}

test("error envelope fixture deserializes with stable codes", () => {
  const payload = readFixture("errors/not-found.json");
  const parsed = parseContractOrThrow(athenaErrorResponseSchema, payload);
  assert.equal(parsed.error.code, "not_found");
  assert.equal(parsed.error.retryable, false);
  assert.equal(parsed.error.requestId, "req_abc123");
});

test("validation error fixture preserves details JsonObject", () => {
  const payload = readFixture("errors/validation.json");
  const parsed = parseContractOrThrow(athenaErrorResponseSchema, payload);
  assert.equal(parsed.error.code, "validation_error");
  assert.deepEqual(parsed.error.details, {
    field: "limit",
    received: -1,
  });
});

test("error envelope rejects unknown error codes", () => {
  const result = safeParseContract(athenaErrorResponseSchema, {
    error: {
      code: "something_weird",
      message: "nope",
      retryable: false,
    },
  });
  assert.equal(result.success, false);
});

test("error envelope allows unknown fields on details only via JsonObject values", () => {
  const parsed = parseContractOrThrow(athenaErrorResponseSchema, {
    error: {
      code: "internal",
      details: { list: [1, "x", null], nested: { ok: true } },
      message: "boom",
      retryable: true,
    },
  });
  assert.equal(parsed.error.code, "internal");
  assert.ok(parsed.error.details);
});

test("mapAthenaErrorCodeToTransportCode covers legacy SDK codes", () => {
  assert.equal(mapAthenaErrorCodeToTransportCode("NOT_FOUND"), "not_found");
  assert.equal(
    mapAthenaErrorCodeToTransportCode("AUTH_UNAUTHORIZED"),
    "authentication_required"
  );
  assert.equal(
    mapAthenaErrorCodeToTransportCode("AUTH_FORBIDDEN"),
    "forbidden"
  );
  assert.equal(
    mapAthenaErrorCodeToTransportCode("VALIDATION_FAILED"),
    "validation_error"
  );
  assert.equal(
    mapAthenaErrorCodeToTransportCode("UNIQUE_VIOLATION"),
    "conflict"
  );
  assert.equal(
    mapAthenaErrorCodeToTransportCode("RATE_LIMITED"),
    "rate_limited"
  );
  assert.equal(
    mapAthenaErrorCodeToTransportCode("TRANSIENT_FAILURE"),
    "transient"
  );
  assert.equal(
    mapAthenaErrorCodeToTransportCode("NETWORK_UNAVAILABLE"),
    "transient"
  );
  assert.equal(mapAthenaErrorCodeToTransportCode("UNKNOWN"), "internal");
});

test("mapNormalizedAthenaErrorToErrorResponse builds envelope", () => {
  const normalized: NormalizedAthenaError = {
    category: "client",
    code: "NOT_FOUND",
    kind: "not_found",
    message: "missing",
    raw: null,
    retryable: false,
    status: 404,
    table: "files",
  };
  const envelope = mapNormalizedAthenaErrorToErrorResponse(normalized, {
    requestId: "req_1",
  });
  assert.deepEqual(envelope, {
    error: {
      code: "not_found",
      details: {
        category: "client",
        kind: "not_found",
        status: 404,
      },
      message: "missing",
      requestId: "req_1",
      retryable: false,
    },
  });
  parseContractOrThrow(athenaErrorResponseSchema, envelope);
});

/**
 * Original case (PR #512 / discussion_r3668032870): detailsFromNormalized copies
 * constraint (and table / related DB identifiers) into public AthenaErrorResponse.details,
 * leaking schema structure to every API consumer (ADR 0021 public transport envelope).
 */
test("P2: Avoid exposing database constraints in public errors", () => {
  const normalized: NormalizedAthenaError = {
    category: "client",
    code: "UNIQUE_VIOLATION",
    constraint: "users_email_key",
    kind: "unknown",
    message: 'duplicate key value violates unique constraint "users_email_key"',
    operation: "insert",
    raw: null,
    retryable: false,
    status: 409,
    table: "users",
  };
  const envelope = mapNormalizedAthenaErrorToErrorResponse(normalized, {
    requestId: "req_unique_1",
  });

  assert.equal(envelope.error.code, "conflict");
  assert.equal(envelope.error.retryable, false);
  assert.equal(envelope.error.requestId, "req_unique_1");

  const details = envelope.error.details ?? {};
  assert.equal(
    Object.hasOwn(details, "constraint"),
    false,
    "public error details must not expose database constraint names"
  );
  assert.equal(
    Object.hasOwn(details, "table"),
    false,
    "public error details must not expose database table identifiers"
  );
  assert.equal(details.constraint, undefined);
  assert.equal(details.table, undefined);

  // Structured details must not re-export schema identifiers (message is free-form).
  const detailsJson = JSON.stringify(details);
  assert.equal(
    detailsJson.includes("users_email_key"),
    false,
    "constraint name must not appear in public error details"
  );
  assert.equal(
    Object.keys(details).includes("table"),
    false,
    "table must not be a public details key"
  );

  parseContractOrThrow(athenaErrorResponseSchema, envelope);
});

/**
 * Original case (PR #512 / discussion_r3668975461): public error.message still
 * copies raw DB text with constraint names (e.g. users_email_key) even after
 * structured constraint/table details are scrubbed — schema identifiers leak
 * via the public message string (ADR 0021 public error envelope).
 */
test("P2: Sanitize database messages before publishing them", () => {
  const rawDbMessage =
    'duplicate key value violates unique constraint "users_email_key"';
  const normalized: NormalizedAthenaError = {
    category: "database",
    code: "UNIQUE_VIOLATION",
    constraint: "users_email_key",
    kind: "unique_violation",
    message: rawDbMessage,
    operation: "insert",
    raw: null,
    retryable: false,
    status: 409,
    table: "users",
  };
  const envelope = mapNormalizedAthenaErrorToErrorResponse(normalized, {
    requestId: "req_msg_scrub_1",
  });

  assert.equal(envelope.error.code, "conflict");
  assert.equal(
    envelope.error.message.includes("users_email_key"),
    false,
    "public error.message must not leak database constraint names"
  );
  assert.equal(
    envelope.error.message.includes("users"),
    false,
    "public error.message must not leak database table identifiers from the raw DB string"
  );
  assert.notEqual(
    envelope.error.message,
    rawDbMessage,
    "public message must not be a verbatim copy of the database error text"
  );
  assert.equal(
    typeof envelope.error.message === "string" &&
      envelope.error.message.trim().length > 0,
    true,
    "public message must remain a non-empty string for clients"
  );

  const details = envelope.error.details ?? {};
  assert.equal(Object.hasOwn(details, "constraint"), false);
  assert.equal(Object.hasOwn(details, "table"), false);

  parseContractOrThrow(athenaErrorResponseSchema, envelope);
});

/**
 * Original case (PR #512 / discussion_r3669238929): when category is
 * "database" but the message text is outside phrase heuristics (e.g. Postgres
 * syntax errors or auth failures embedding table/user names), the public
 * message was still the raw DB string. Category must force sanitization.
 */
test("P2: Sanitize every database-category message", () => {
  const syntaxMsg = 'syntax error at or near "customer_secrets"';
  const syntaxEnvelope = mapNormalizedAthenaErrorToErrorResponse({
    category: "database",
    code: "UNKNOWN",
    kind: "unknown",
    message: syntaxMsg,
    raw: null,
    retryable: false,
    status: 500,
  });
  assert.notEqual(
    syntaxEnvelope.error.message,
    syntaxMsg,
    "database-category syntax errors must not publish raw message text"
  );
  assert.equal(
    syntaxEnvelope.error.message.includes("customer_secrets"),
    false,
    "public message must not leak table identifiers from non-heuristic DB text"
  );
  assert.equal(
    typeof syntaxEnvelope.error.message === "string" &&
      syntaxEnvelope.error.message.trim().length > 0,
    true
  );

  const authMsg = 'password authentication failed for user "athena_admin"';
  const authEnvelope = mapNormalizedAthenaErrorToErrorResponse({
    category: "database",
    code: "UNKNOWN",
    kind: "unknown",
    message: authMsg,
    raw: null,
    retryable: false,
    status: 500,
  });
  assert.notEqual(authEnvelope.error.message, authMsg);
  assert.equal(
    authEnvelope.error.message.includes("athena_admin"),
    false,
    "public message must not leak DB role names from non-heuristic DB text"
  );

  parseContractOrThrow(athenaErrorResponseSchema, syntaxEnvelope);
  parseContractOrThrow(athenaErrorResponseSchema, authEnvelope);
});

/**
 * Original case (PR #512 / discussion_r3669238937): docs recommend
 * `@xylex-group/athena/contracts/v1` but package.json exports and tsup had no
 * contracts entry, so consumer resolution failed.
 */
test("P2: Export the advertised v1 contract subpath", () => {
  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as {
    exports?: Record<string, unknown>;
    typesVersions?: { "*": Record<string, string[]> };
  };
  const tsupSource = readFileSync(join(packageRoot, "tsup.config.ts"), "utf8");

  assert.equal(
    pkg.exports !== null && typeof pkg.exports?.["./contracts/v1"] === "object",
    true,
    "package.json must export ./contracts/v1 for version-pinned consumers"
  );
  assert.equal(
    pkg.exports !== null && typeof pkg.exports?.["./contracts"] === "object",
    true,
    "package.json must export ./contracts umbrella subpath"
  );

  const v1Export = pkg.exports?.["./contracts/v1"] as {
    import?: string;
    types?: string;
  };
  assert.equal(
    typeof v1Export?.import === "string" &&
      v1Export.import.includes("contracts/v1"),
    true,
    "contracts/v1 import path must resolve under dist/contracts/v1"
  );
  assert.equal(
    typeof v1Export?.types === "string" &&
      v1Export.types.includes("contracts/v1"),
    true,
    "contracts/v1 types path must resolve under dist/contracts/v1"
  );

  assert.match(
    tsupSource,
    /["']contracts\/v1["']\s*:\s*["']src\/contracts\/v1\/index\.ts["']/,
    "tsup must build the contracts/v1 entrypoint"
  );
  assert.match(
    tsupSource,
    /(?:["']contracts["']|contracts)\s*:\s*["']src\/contracts\/index\.ts["']/,
    "tsup must build the contracts umbrella entrypoint"
  );

  const typesV1 = pkg.typesVersions?.["*"]?.["contracts/v1"];
  assert.equal(
    Array.isArray(typesV1) && typesV1.some((p) => p.includes("contracts/v1")),
    true,
    "typesVersions must map contracts/v1 for TypeScript resolution"
  );
});

/**
 * Original case (PR #512 / discussion_r3670415201): under type:module, Node 18
 * require() walks export conditions in declaration order. With `default` before
 * `require`, Node picks the ESM .js and throws ERR_REQUIRE_ESM, so .cjs is
 * unreachable for @xylex-group/athena/contracts and /contracts/v1.
 */
test("P1: Move default after require in contract exports", () => {
  // Read raw JSON text so key order matches package.json source (JSON.parse
  // preserves insertion order, matching Node's condition walk order).
  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as {
    exports?: Record<string, Record<string, string>>;
  };

  for (const subpath of ["./contracts", "./contracts/v1"] as const) {
    const entry = pkg.exports?.[subpath];
    assert.ok(
      entry && typeof entry === "object",
      `exports["${subpath}"] must exist`
    );
    const keys = Object.keys(entry);
    const defaultIdx = keys.indexOf("default");
    const requireIdx = keys.indexOf("require");
    assert.ok(requireIdx >= 0, `exports["${subpath}"] must declare require`);
    assert.ok(defaultIdx >= 0, `exports["${subpath}"] must declare default`);
    assert.ok(
      defaultIdx > requireIdx,
      `exports["${subpath}"]: default (index ${defaultIdx}) must come after require (index ${requireIdx}) so Node 18 require() resolves to .cjs, not ESM (ERR_REQUIRE_ESM). Keys: ${keys.join(", ")}`
    );
    assert.match(
      entry.require,
      /\.cjs$/,
      `exports["${subpath}"].require must point at .cjs`
    );
  }
});

test("P2: Map retryable HTTP failures to transient", () => {
  // Original case: HTTP 5xx / gateway outage normalized as HTTP_FAILURE with
  // kind=transient and retryable=true must surface transport code "transient",
  // not code-only "internal", so machine-readable clients can retry.
  const normalized: NormalizedAthenaError = {
    category: "server",
    code: "HTTP_FAILURE",
    kind: "transient",
    message: "Bad Gateway",
    raw: null,
    retryable: true,
    status: 502,
  };
  const envelope = mapNormalizedAthenaErrorToErrorResponse(normalized);
  assert.equal(
    envelope.error.code,
    "transient",
    "HTTP_FAILURE with kind=transient must map to transport code transient, not internal"
  );
  assert.equal(envelope.error.retryable, true);
  parseContractOrThrow(athenaErrorResponseSchema, envelope);
});

test("cursor page fixture and limit-plus-one mapper", () => {
  const fixture = readFixture("pagination/cursor-page.json");
  const schema = pageSchema(z.object({ id: z.string() }));
  const parsed = parseContractOrThrow(schema, fixture);
  assert.equal(parsed.hasMore, true);
  assert.equal(parsed.nextCursor, "cursor_b");

  const page = mapLimitPlusOneToPage(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    2,
    (item) => item.id
  );
  assert.deepEqual(page, {
    hasMore: true,
    items: [{ id: "a" }, { id: "b" }],
    nextCursor: "b",
  });

  const lastPage = mapLimitPlusOneToPage([{ id: "a" }], 2, (item) => item.id);
  assert.deepEqual(lastPage, {
    hasMore: false,
    items: [{ id: "a" }],
    nextCursor: null,
  });
});

test("offset page fixture and offset window mapper", () => {
  const fixture = readFixture("pagination/offset-page.json");
  const schema = offsetPageSchema(z.object({ id: z.string() }));
  const parsed = parseContractOrThrow(schema, fixture);
  assert.equal(parsed.total, 10);
  assert.equal(parsed.hasMore, true);

  const page = mapOffsetWindowToOffsetPage({
    items: [{ id: "1" }, { id: "2" }, { id: "3" }],
    limit: 2,
    limitPlusOne: true,
    offset: 0,
    total: 10,
  });
  assert.deepEqual(page, {
    hasMore: true,
    items: [{ id: "1" }, { id: "2" }],
    limit: 2,
    offset: 0,
    total: 10,
  });
});

test("P2: Auto-trim zero-length offset windows", () => {
  // Original case: limit=0 with limitPlusOne and a one-row lookahead skipped
  // auto-trim (limit > 0 guard), yielding { items: [row], limit: 0, hasMore: false }.
  // limitPlusOne trim/hasMore must apply for every nonnegative limit, including 0
  // (mirror mapLimitPlusOneToPage safeLimit === 0 empty window).
  const page = mapOffsetWindowToOffsetPage({
    items: [{ id: "lookahead" }],
    limit: 0,
    limitPlusOne: true,
    offset: 0,
  });
  assert.deepEqual(page, {
    hasMore: true,
    items: [],
    limit: 0,
    offset: 0,
  });
});

/**
 * Original case (PR #512 / discussion_r3687083537): when callers provide both
 * a known hasMore and limitPlusOne:true, overwriting hasMore with
 * items.length > limit drops the authoritative signal. Example: server-backed
 * page already capped to `limit` items with hasMore:true was returned as
 * terminal (hasMore:false). Trim lookahead independently; infer hasMore from
 * length only when input.hasMore is undefined.
 */
test("P2: Preserve explicit availability while trimming lookahead", () => {
  // Cap already applied server-side: length === limit, explicit hasMore:true
  const capped = mapOffsetWindowToOffsetPage({
    hasMore: true,
    items: [{ id: "1" }, { id: "2" }],
    limit: 2,
    limitPlusOne: true,
    offset: 0,
  });
  assert.equal(
    capped.hasMore,
    true,
    "explicit hasMore:true must survive limitPlusOne when no extra row is present"
  );
  assert.deepEqual(capped.items, [{ id: "1" }, { id: "2" }]);

  // Lookahead row present + explicit hasMore:true ? trim and keep hasMore
  const withLookahead = mapOffsetWindowToOffsetPage({
    hasMore: true,
    items: [{ id: "1" }, { id: "2" }, { id: "3" }],
    limit: 2,
    limitPlusOne: true,
    offset: 0,
  });
  assert.deepEqual(withLookahead.items, [{ id: "1" }, { id: "2" }]);
  assert.equal(withLookahead.hasMore, true);

  // Explicit hasMore:false still trims; does not flip to true from length
  const noMore = mapOffsetWindowToOffsetPage({
    hasMore: false,
    items: [{ id: "1" }, { id: "2" }, { id: "3" }],
    limit: 2,
    limitPlusOne: true,
    offset: 0,
  });
  assert.deepEqual(noMore.items, [{ id: "1" }, { id: "2" }]);
  assert.equal(noMore.hasMore, false);

  // Omitted hasMore still infers from length
  const inferred = mapOffsetWindowToOffsetPage({
    items: [{ id: "1" }, { id: "2" }, { id: "3" }],
    limit: 2,
    limitPlusOne: true,
    offset: 0,
  });
  assert.deepEqual(inferred.items, [{ id: "1" }, { id: "2" }]);
  assert.equal(inferred.hasMore, true);
});

test("P2: Report more rows for zero-length cursor windows", () => {
  // Original case: mapLimitPlusOneToPage(rows=[lookahead], limit=0) early-returned
  // hasMore:false, disagreeing with mapOffsetWindowToOffsetPage limitPlusOne:true
  // at limit 0 (empty items + hasMore from rows.length > 0).
  const withLookahead = mapLimitPlusOneToPage(
    [{ id: "lookahead" }],
    0,
    (item) => item.id
  );
  assert.deepEqual(withLookahead, {
    hasMore: true,
    items: [],
    nextCursor: null,
  });
  const empty = mapLimitPlusOneToPage([], 0, (item: { id: string }) => item.id);
  assert.deepEqual(empty, {
    hasMore: false,
    items: [],
    nextCursor: null,
  });
});

test("clampPaginationLimit respects policy max", () => {
  assert.equal(clampPaginationLimit(9999, "STORAGE"), 500);
  assert.equal(clampPaginationLimit(undefined, "AUTH_LIST_USERS"), 100);
  assert.equal(clampPaginationLimit(0, "DEFAULT"), 1);
  assert.equal(clampPaginationLimit(25, "CHAT_LIST_MESSAGES"), 25);
});

test("P2: Clamp explicit low limits to the server minimum", () => {
  // Original case: clampPaginationLimit(0 or negative) returned the endpoint
  // default (e.g. 50) instead of server min 1; chat uses unwrap_or(default).clamp(1,max).
  // Explicit finite low limits must clamp to [1, max], not substitute default.
  assert.equal(clampPaginationLimit(0, "DEFAULT"), 1);
  assert.equal(clampPaginationLimit(-1, "DEFAULT"), 1);
  assert.equal(clampPaginationLimit(-100, "CHAT_LIST_MESSAGES"), 1);
  assert.equal(clampPaginationLimit(0, "CHAT_SEARCH_MESSAGES"), 1);
  // Omitted / non-finite still use endpoint default.
  assert.equal(clampPaginationLimit(undefined, "DEFAULT"), 50);
  assert.equal(clampPaginationLimit(Number.NaN, "CHAT_LIST_MESSAGES"), 50);
});

test("P2: Preserve zero limits for auth list-users", () => {
  // Original case: AUTH list-users server allows limit 0 (only .min(max); no minLimit),
  // but clampPaginationLimit always floored finite limits to 1, so empty/count-only
  // list-users requests with limit 0 unexpectedly became a one-user fetch.
  assert.equal(PaginationLimitPolicy.AUTH_LIST_USERS.minLimit, 0);
  assert.equal(clampPaginationLimit(0, "AUTH_LIST_USERS"), 0);
  assert.equal(clampPaginationLimit(-1, "AUTH_LIST_USERS"), 0);
  // Chat/default still floor at 1.
  assert.equal(clampPaginationLimit(0, "CHAT_LIST_MESSAGES"), 1);
  assert.equal(clampPaginationLimit(0, "DEFAULT"), 1);
});

test("P2: Accept zero in the offset request validator", () => {
  // Original case: clampPaginationLimit(0, "AUTH_LIST_USERS") yields 0 for empty/count-only
  // list-users, but offsetPageRequestSchema used .positive() and rejected limit: 0 —
  // so clamp/normalize and public request validation disagreed for AUTH_LIST_USERS.
  assert.equal(PaginationLimitPolicy.AUTH_LIST_USERS.minLimit, 0);
  const clamped = clampPaginationLimit(0, "AUTH_LIST_USERS");
  assert.equal(clamped, 0);
  const parsed = offsetPageRequestSchema.safeParse({
    limit: clamped,
    offset: 0,
  });
  assert.equal(
    parsed.success,
    true,
    "offsetPageRequestSchema must accept limit 0 after AUTH_LIST_USERS clamp"
  );
  if (parsed.success) {
    assert.equal(parsed.data.limit, 0);
    assert.equal(parsed.data.offset, 0);
  }
});

test("P2: Keep pagination limits endpoint-specific", () => {
  // Original case: service-wide AUTH (50/200) and CHAT (50/100) did not match
  // real surfaces (list-users 100/500; chat list 50/200; search 25/100), so
  // clampPaginationLimit silently changed defaults and clamped valid limits
  // (auth 201–500, chat 101–200).
  assert.deepEqual(PaginationLimitPolicy.AUTH_LIST_USERS, {
    defaultLimit: 100,
    maxLimit: 500,
    minLimit: 0,
  });
  assert.equal(clampPaginationLimit(undefined, "AUTH_LIST_USERS"), 100);
  assert.equal(clampPaginationLimit(300, "AUTH_LIST_USERS"), 300);
  assert.equal(clampPaginationLimit(500, "AUTH_LIST_USERS"), 500);

  assert.deepEqual(PaginationLimitPolicy.CHAT_LIST_MESSAGES, {
    defaultLimit: 50,
    maxLimit: 200,
    minLimit: 1,
  });
  assert.deepEqual(PaginationLimitPolicy.CHAT_LIST_ROOMS, {
    defaultLimit: 50,
    maxLimit: 200,
    minLimit: 1,
  });
  assert.equal(clampPaginationLimit(150, "CHAT_LIST_MESSAGES"), 150);
  assert.equal(clampPaginationLimit(200, "CHAT_LIST_ROOMS"), 200);

  assert.deepEqual(PaginationLimitPolicy.CHAT_SEARCH_MESSAGES, {
    defaultLimit: 25,
    maxLimit: 100,
    minLimit: 1,
  });
  assert.equal(clampPaginationLimit(undefined, "CHAT_SEARCH_MESSAGES"), 25);
  assert.equal(clampPaginationLimit(100, "CHAT_SEARCH_MESSAGES"), 100);

  // Caller-supplied policy aligned to a real surface (no coarse service key).
  assert.equal(
    clampPaginationLimit(175, { defaultLimit: 50, maxLimit: 200 }),
    175
  );

  // Coarse service-wide AUTH/CHAT policies must not exist.
  assert.equal(Object.hasOwn(PaginationLimitPolicy, "AUTH"), false);
  assert.equal(Object.hasOwn(PaginationLimitPolicy, "CHAT"), false);
});

test("jsonObjectSchema accepts nested JSON and rejects non-JSON values", () => {
  const ok = parseContractOrThrow(jsonObjectSchema, {
    a: 1,
    b: [true, null, { c: "x" }],
  });
  assert.equal(ok.a, 1);

  const bad = safeParseContract(jsonObjectSchema, { fn: () => 1 });
  assert.equal(bad.success, false);
});

test("round-trip serialize error envelope", () => {
  const original = {
    error: {
      code: "rate_limited" as const,
      message: "slow down",
      requestId: "r2",
      retryable: true,
    },
  };
  const json = JSON.stringify(original);
  const parsed = parseContractOrThrow(
    athenaErrorResponseSchema,
    JSON.parse(json)
  );
  assert.deepEqual(parsed, original);
});

/**
 * Original case (PR #512 / discussion_r3662404919): plain z.object strips
 * unknown keys. A valid gateway error with drifted `request_id` (snake_case)
 * still parses and silently drops the correlation id — strict-on-errors fails.
 */
test("P2: Reject unknown fields in error envelopes", () => {
  const driftedBody = safeParseContract(athenaErrorResponseSchema, {
    error: {
      code: "not_found",
      message: "File not found",
      request_id: "req_corr_should_not_strip",
      retryable: false,
    },
  });
  assert.equal(
    driftedBody.success,
    false,
    "unknown error body field request_id must be rejected, not stripped"
  );

  const driftedEnvelope = safeParseContract(athenaErrorResponseSchema, {
    error: {
      code: "not_found",
      message: "File not found",
      retryable: false,
    },
    request_id: "req_outer",
  });
  assert.equal(
    driftedEnvelope.success,
    false,
    "unknown outer envelope field must be rejected, not stripped"
  );
});

/**
 * Original case (PR #512 / discussion_r3662404923): Page<T, TCursor> and
 * mapLimitPlusOneToPage allow any cursor type, but pageSchema only accepted
 * string nextCursor — a numeric-ID cursor page failed runtime validation.
 */
test("P2: Accept the configured cursor type in page schemas", () => {
  const numericPage = mapLimitPlusOneToPage(
    [{ id: 10 }, { id: 20 }, { id: 30 }],
    2,
    (item) => item.id
  );
  assert.equal(numericPage.nextCursor, 20);
  assert.equal(typeof numericPage.nextCursor, "number");

  const numberCursorSchema = pageSchema(
    z.object({ id: z.number() }),
    z.number()
  );
  const parsed = parseContractOrThrow(numberCursorSchema, numericPage);
  assert.equal(parsed.nextCursor, 20);
  assert.deepEqual(
    parsed.items.map((item) => item.id),
    [10, 20]
  );

  const defaultStringSchema = pageSchema(z.object({ id: z.number() }));
  const stringOnlyRejectsNumber = safeParseContract(defaultStringSchema, {
    hasMore: true,
    items: [{ id: 1 }],
    nextCursor: 99,
  });
  assert.equal(
    stringOnlyRejectsNumber.success,
    false,
    "default pageSchema still requires string cursors"
  );

  const numberRequestSchema = cursorPageRequestSchema(z.number());
  const request = parseContractOrThrow(numberRequestSchema, {
    cursor: 42,
    limit: 10,
  });
  assert.equal(request.cursor, 42);
});

/**
 * Original case (PR #512 / discussion_r3670415205): sequencePageSchema expects
 * camelCase nextBeforeSeq + hasMore, but athena-chat MessagePage wire is
 * { items, next_before_seq } without hasMore — validating real chat list JSON
 * always fails. Map wire→SequencePage (derive hasMore) before validation.
 */
test("P2: Map chat sequence pages before validating them", () => {
  const itemSchema = z.object({
    id: z.string(),
    room_seq: z.number().int(),
  });
  const schema = sequencePageSchema(itemSchema);

  // Real chat MessagePage wire (snake_case cursor, no hasMore).
  // Without explicit has_more / limit+1, do not claim hasMore from full page.
  const chatWireFullPage = {
    items: [
      { id: "msg_1", room_seq: 10 },
      { id: "msg_2", room_seq: 11 },
    ],
    limit: 2,
    next_before_seq: 10,
  };
  const directWithMore = safeParseContract(schema, chatWireFullPage);
  assert.equal(
    directWithMore.success,
    false,
    "sequencePageSchema must reject raw chat MessagePage wire (snake_case / no hasMore)"
  );

  const mappedFullPage = mapChatMessagePageWireToSequencePage(chatWireFullPage);
  assert.deepEqual(mappedFullPage, {
    hasMore: false,
    items: [
      { id: "msg_1", room_seq: 10 },
      { id: "msg_2", room_seq: 11 },
    ],
    nextBeforeSeq: 10,
  });
  const parsedFullPage = parseContractOrThrow(schema, mappedFullPage);
  assert.equal(parsedFullPage.nextBeforeSeq, 10);
  assert.equal(parsedFullPage.hasMore, false);

  const chatWireWithMore = {
    ...chatWireFullPage,
    has_more: true,
  };
  const mappedWithMore = mapChatMessagePageWireToSequencePage(chatWireWithMore);
  assert.deepEqual(mappedWithMore, {
    hasMore: true,
    items: [
      { id: "msg_1", room_seq: 10 },
      { id: "msg_2", room_seq: 11 },
    ],
    nextBeforeSeq: 10,
  });
  const parsedWithMore = parseContractOrThrow(schema, mappedWithMore);
  assert.equal(parsedWithMore.nextBeforeSeq, 10);
  assert.equal(parsedWithMore.hasMore, true);

  // Last page: missing / null next_before_seq → hasMore false, nextBeforeSeq null.
  const chatWireLast = {
    items: [{ id: "msg_0", room_seq: 1 }],
    next_before_seq: null as number | null,
  };
  const directLast = safeParseContract(schema, chatWireLast);
  assert.equal(
    directLast.success,
    false,
    "last-page chat wire without hasMore must not pass sequencePageSchema"
  );
  const mappedLast = mapChatMessagePageWireToSequencePage(chatWireLast);
  assert.deepEqual(mappedLast, {
    hasMore: false,
    items: [{ id: "msg_0", room_seq: 1 }],
    nextBeforeSeq: null,
  });
  parseContractOrThrow(schema, mappedLast);

  const chatWireOmittedCursor = {
    items: [{ id: "msg_only", room_seq: 3 }],
  };
  const mappedOmitted = mapChatMessagePageWireToSequencePage(
    chatWireOmittedCursor
  );
  assert.equal(mappedOmitted.nextBeforeSeq, null);
  assert.equal(mappedOmitted.hasMore, false);
  parseContractOrThrow(schema, mappedOmitted);
});

/**
 * Original case (PR #512 / discussion_r3672401247): athena-chat MessagePage sets
 * next_before_seq on every nonempty page (no limit+1 lookahead). Deriving hasMore
 * from next_before_seq alone marks terminal short pages as hasMore:true and causes
 * spurious load-more UI / empty next-page fetches.
 */
test("P2: Report terminal chat pages without more results", () => {
  // Terminal page: fewer items than the request limit, but server still returns
  // next_before_seq (oldest seq on the page) for every nonempty page.
  const terminalWire = {
    items: [
      { id: "msg_a", room_seq: 1 },
      { id: "msg_b", room_seq: 2 },
      { id: "msg_c", room_seq: 3 },
    ],
    limit: 50,
    next_before_seq: 1,
  };
  const mappedTerminal = mapChatMessagePageWireToSequencePage(terminalWire);
  assert.equal(
    mappedTerminal.hasMore,
    false,
    "short (terminal) chat page must not report hasMore when items.length < limit"
  );
  assert.equal(mappedTerminal.nextBeforeSeq, 1);
  assert.equal(mappedTerminal.items.length, 3);

  // Full page + cursor alone still must not claim hasMore (no server lookahead).
  const fullWire = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: `msg_${i}`,
      room_seq: i + 1,
    })),
    limit: 50,
    next_before_seq: 1,
  };
  const mappedFull = mapChatMessagePageWireToSequencePage(fullWire);
  assert.equal(
    mappedFull.hasMore,
    false,
    "full page (items.length === limit) without has_more/limit+1 must not claim more results"
  );
  assert.equal(mappedFull.nextBeforeSeq, 1);
});

/**
 * Original case (PR #512 / discussion_r3672510519): list_messages returns only LIMIT
 * rows and always supplies next_before_seq on nonempty pages without lookahead.
 * Treating full page + cursor as hasMore makes exact-multiple terminal pages
 * (items.length === limit) spuriously report hasMore:true and drive empty load-more.
 * Require explicit has_more or limit+1 semantics — not full-page heuristics alone.
 */
test("P2: Avoid claiming more results on exact terminal pages", () => {
  // Exact terminal page: exactly `limit` items and a cursor (server always sends
  // next_before_seq on nonempty pages; no lookahead proves more rows exist).
  const exactTerminalWire = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: `msg_${i}`,
      room_seq: i + 1,
    })),
    limit: 50,
    next_before_seq: 1,
  };
  const mappedExact = mapChatMessagePageWireToSequencePage(exactTerminalWire);
  assert.equal(
    mappedExact.hasMore,
    false,
    "exact-multiple terminal page (items.length === limit + cursor) must not claim hasMore without lookahead or has_more"
  );
  assert.equal(mappedExact.nextBeforeSeq, 1);
  assert.equal(mappedExact.items.length, 50);

  // Explicit has_more from wire is the availability signal when present.
  const withExplicit = mapChatMessagePageWireToSequencePage({
    ...exactTerminalWire,
    has_more: true,
  });
  assert.equal(
    withExplicit.hasMore,
    true,
    "explicit has_more:true must set hasMore"
  );

  // limit+1 fetch (ASC after reverse): extra oldest row proves more results;
  // keep last `limit` items and derive nextBeforeSeq from oldest retained.
  const limitPlusOneWire = {
    items: Array.from({ length: 51 }, (_, i) => ({
      id: `msg_${i}`,
      room_seq: i + 1,
    })),
    limit: 50,
    limitPlusOne: true as const,
    next_before_seq: 1,
  };
  const mappedLookahead =
    mapChatMessagePageWireToSequencePage(limitPlusOneWire);
  assert.equal(mappedLookahead.hasMore, true);
  assert.equal(mappedLookahead.items.length, 50);
  assert.equal(mappedLookahead.items[0]?.room_seq, 2);
  assert.equal(mappedLookahead.items[49]?.room_seq, 51);
  assert.equal(mappedLookahead.nextBeforeSeq, 2);
});

/**
 * Original case (PR #512 / discussion_r3678324257): Chat limit+1 rows are ASC
 * after reverse (oldest at index 0, newest at end). slice(0, limit) drops the
 * newest row instead of the oldest lookahead, so nextBeforeSeq/cursor can point
 * at the wrong retained boundary and the newest message is lost.
 */
test("P2: Trim the oldest chat lookahead row", () => {
  // ASC page after reverse: extra oldest row at index 0 proves hasMore.
  // limit=3 with 4 rows → keep newest 3, drop lookahead at index 0.
  const ascLookaheadWire = {
    items: [
      { id: "msg_old", room_seq: 10 }, // oldest lookahead (must drop)
      { id: "msg_a", room_seq: 11 },
      { id: "msg_b", room_seq: 12 },
      { id: "msg_new", room_seq: 13 }, // newest (must retain)
    ],
    limit: 3,
    limitPlusOne: true as const,
    next_before_seq: 10,
  };
  const mapped = mapChatMessagePageWireToSequencePage(ascLookaheadWire);

  assert.equal(mapped.hasMore, true, "limit+1 ASC page must report hasMore");
  assert.equal(mapped.items.length, 3, "must retain exactly limit rows");
  assert.deepEqual(
    mapped.items.map((m) => m.id),
    ["msg_a", "msg_b", "msg_new"],
    "must drop oldest lookahead at index 0, not the newest row"
  );
  assert.equal(
    mapped.nextBeforeSeq,
    11,
    "nextBeforeSeq must be oldest retained seq (not dropped lookahead / wrong boundary)"
  );
  assert.ok(
    mapped.items.every((m) => m.id !== "msg_old"),
    "oldest lookahead row must not appear in retained items"
  );
  assert.ok(
    mapped.items.some((m) => m.id === "msg_new"),
    "newest message must be retained after limit+1 trim"
  );
});

/**
 * Original case (PR #512 / discussion_r3678324265): limitPlusOne:true with
 * omitted limit sets safeLimit=0, so nonempty items are trimmed to [] and
 * hasMore becomes true. Optional limit must not default to 0 under
 * limitPlusOne — require a finite limit for lookahead trim/hasMore.
 */
test("P2: Require a limit when enabling chat lookahead", () => {
  const items = [
    { id: "msg_1", room_seq: 1 },
    { id: "msg_2", room_seq: 2 },
  ];
  const mapped = mapChatMessagePageWireToSequencePage({
    items,
    limitPlusOne: true,
    next_before_seq: 1,
    // limit intentionally omitted — must not treat as safeLimit=0
  });
  assert.equal(
    mapped.items.length,
    2,
    "omitted limit + limitPlusOne must not wipe nonempty items to []"
  );
  assert.deepEqual(mapped.items, items);
  assert.equal(
    mapped.hasMore,
    false,
    "omitted limit + limitPlusOne must not invent hasMore from length > 0"
  );
  assert.equal(mapped.nextBeforeSeq, 1);

  // Finite limit still enables limit+1 trim/hasMore.
  const withLimit = mapChatMessagePageWireToSequencePage({
    items: [...items, { id: "msg_3", room_seq: 3 }],
    limit: 2,
    limitPlusOne: true,
    next_before_seq: 1,
  });
  assert.equal(withLimit.hasMore, true);
  assert.equal(withLimit.items.length, 2);
});

/**
 * Original case (PR #512 / discussion_r3687053473): when has_more is supplied
 * together with limitPlusOne:true, the has_more branch skipped the only
 * lookahead-trimming block. Example `{ items: [oldest, a, b], limit: 2,
 * limitPlusOne: true, has_more: true }` returned all three rows and kept the
 * lookahead cursor. Trim independently of selecting the hasMore signal.
 */
test("P2: Trim lookahead rows even when has_more is present", () => {
  const oldest = { id: "oldest", room_seq: 1 };
  const a = { id: "a", room_seq: 2 };
  const b = { id: "b", room_seq: 3 };
  const mapped = mapChatMessagePageWireToSequencePage({
    has_more: true,
    items: [oldest, a, b],
    limit: 2,
    limitPlusOne: true,
    next_before_seq: 1,
  });
  assert.equal(
    mapped.items.length,
    2,
    "limitPlusOne must auto-trim to limit even when has_more is present"
  );
  assert.deepEqual(
    mapped.items,
    [a, b],
    "ASC chat lookahead: drop leading oldest row, keep newest limit rows"
  );
  assert.equal(
    mapped.hasMore,
    true,
    "explicit has_more:true must still set hasMore"
  );
  assert.equal(
    mapped.nextBeforeSeq,
    2,
    "after trim, nextBeforeSeq must come from oldest retained item room_seq"
  );

  // Explicit has_more:false still trims lookahead; hasMore stays false.
  const noMore = mapChatMessagePageWireToSequencePage({
    has_more: false,
    items: [oldest, a, b],
    limit: 2,
    limitPlusOne: true,
    next_before_seq: 1,
  });
  assert.equal(noMore.items.length, 2);
  assert.deepEqual(noMore.items, [a, b]);
  assert.equal(noMore.hasMore, false);
  assert.equal(noMore.nextBeforeSeq, 2);
});

/**
 * Original case (PR #512 / discussion_r3662999815): jsonValueSchema is annotated
 * with unknown[] and {[key: string]: unknown}, so z.infer is broader than JsonValue.
 * parseContractOrThrow(jsonValueSchema|jsonObjectSchema, ...) results need casts
 * to assign to JsonValue/JsonObject despite successful parse.
 */
test("P2: Preserve JsonValue inference in the recursive schema", () => {
  const nested = { nested: [1, true, null, "x"] };
  const parsedValue = parseContractOrThrow(jsonValueSchema, nested);
  const parsedObject = parseContractOrThrow(jsonObjectSchema, {
    a: 1,
    b: [null, { c: "y" }],
  });
  assert.deepEqual(parsedValue, nested);
  assert.deepEqual(parsedObject, { a: 1, b: [null, { c: "y" }] });

  // Type-level contract: inference must match public DTOs (no cast required).
  // Runtime tests cannot see TS assignability; focused tsc fixture encodes it.
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "tsc",
      "-p",
      "test/tsconfig.json-value-infer.json",
      "--pretty",
      "false",
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    }
  );
  assert.equal(
    result.status,
    0,
    `jsonValueSchema/jsonObjectSchema must infer JsonValue/JsonObject so parse results assign without casts:\n${result.stdout}\n${result.stderr}`
  );

  // Call-site proof without casts (types now agree with JsonValue/JsonObject).
  const asValue: JsonValue = parsedValue;
  const asObject: JsonObject = parsedObject;
  assert.equal(asValue, parsedValue);
  assert.equal(asObject, parsedObject);
});

/**
 * Original case (PR #512 / discussion_r3667620377): safeParseContract with
 * jsonValueSchema/jsonObjectSchema on cyclic objects stack-overflows
 * (RangeError) instead of returning { success: false }. Soft-parse API must
 * not throw on self-referential unknown input.
 */
test("P2: Handle cyclic values in soft contract parsing", () => {
  const cyclicObj: Record<string, unknown> = { a: 1 };
  cyclicObj.self = cyclicObj;

  const cyclicArr: unknown[] = [1];
  cyclicArr.push(cyclicArr);

  let objThrew: unknown;
  let objResult:
    | { success: true; data: unknown }
    | { success: false; error: { issues: unknown[] } }
    | undefined;
  try {
    objResult = safeParseContract(jsonObjectSchema, cyclicObj);
  } catch (err) {
    objThrew = err;
  }

  assert.equal(
    objThrew,
    undefined,
    `safeParseContract must not throw on cyclic object (got ${String(objThrew)})`
  );
  assert.ok(objResult, "safeParseContract must return a result");
  assert.equal(
    objResult!.success,
    false,
    "cyclic object is not valid JSON; soft parse must return success:false"
  );
  assert.ok(
    objResult!.success === false &&
      Array.isArray(objResult.error.issues) &&
      objResult.error.issues.length > 0,
    "failure must include at least one issue"
  );

  let arrThrew: unknown;
  let arrResult:
    | { success: true; data: unknown }
    | { success: false; error: { issues: unknown[] } }
    | undefined;
  try {
    arrResult = safeParseContract(jsonValueSchema, cyclicArr);
  } catch (err) {
    arrThrew = err;
  }

  assert.equal(
    arrThrew,
    undefined,
    `safeParseContract must not throw on cyclic array (got ${String(arrThrew)})`
  );
  assert.ok(arrResult, "safeParseContract must return a result");
  assert.equal(
    arrResult!.success,
    false,
    "cyclic array is not valid JSON; soft parse must return success:false"
  );
});

/**
 * Original case (PR #512 / discussion_r3668032879): parseContractOrThrow with
 * recursive json schemas on cyclic/nested input throws raw RangeError instead of
 * AthenaContractParseError with structured issues/path. Callers lose the contract
 * error type; only safeParseContract currently catches stack overflow.
 */
test("P2: Wrap recursive failures in the throwing parser", () => {
  const cyclicObj: Record<string, unknown> = { a: 1 };
  cyclicObj.self = cyclicObj;

  let thrown: unknown;
  try {
    parseContractOrThrow(jsonObjectSchema, cyclicObj, "body");
  } catch (err) {
    thrown = err;
  }

  assert.ok(
    thrown !== undefined,
    "parseContractOrThrow must throw on cyclic input"
  );
  assert.ok(
    thrown instanceof AthenaContractParseError,
    `must throw AthenaContractParseError, not raw ${
      thrown instanceof Error ? thrown.name : typeof thrown
    }: ${thrown instanceof Error ? thrown.message : String(thrown)}`
  );
  assert.equal(thrown.path, "body");
  assert.ok(
    Array.isArray(thrown.issues) && thrown.issues.length > 0,
    "AthenaContractParseError must carry structured issues"
  );
});

/**
 * Original case (PR #512 / discussion_r3672401253): SequencePageRequest is a
 * public request DTO but only cursor/offset page requests have runtime Zod
 * schemas — untrusted beforeSeq/limit cannot be validated through the contract API.
 */
test("P2: Add a runtime validator for sequence page requests", async () => {
  const runtime = await import("../src/runtime/index.ts");
  assert.equal(
    "sequencePageRequestSchema" in runtime,
    true,
    "runtime must export sequencePageRequestSchema for SequencePageRequest"
  );
  const schema = (
    runtime as {
      sequencePageRequestSchema: {
        safeParse: (value: unknown) => { success: boolean; data?: unknown };
      };
    }
  ).sequencePageRequestSchema;

  const valid = schema.safeParse({ beforeSeq: 42, limit: 25 });
  assert.equal(valid.success, true, "valid beforeSeq/limit must parse");
  assert.deepEqual(valid.data, { beforeSeq: 42, limit: 25 });

  const nullCursor = schema.safeParse({ beforeSeq: null, limit: 10 });
  assert.equal(nullCursor.success, true, "beforeSeq may be null");

  const empty = schema.safeParse({});
  assert.equal(
    empty.success,
    true,
    "all fields optional like SequencePageRequest"
  );

  const badBefore = schema.safeParse({ beforeSeq: "not-a-seq", limit: 10 });
  assert.equal(badBefore.success, false, "non-numeric beforeSeq must fail");

  const badLimit = schema.safeParse({ beforeSeq: 1, limit: 0 });
  assert.equal(badLimit.success, false, "non-positive limit must fail");

  const badLimitType = schema.safeParse({ limit: 1.5 });
  assert.equal(badLimitType.success, false, "non-integer limit must fail");
});
