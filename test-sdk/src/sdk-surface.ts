import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AthenaClient } from "../../src/index.js";

const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
const SKIP_OWN_KEYS = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "toJSON",
  "toString",
  "valueOf",
  "inspect",
]);

export interface SdkSurfaceMethodStatus {
  kind: "function" | "object" | "other" | "missing";
  path: string;
  present: boolean;
}

export interface SdkSurfaceCoverage {
  documented: SdkSurfaceMethodStatus[];
  livePaths: string[];
  missing: string[];
  missingCount: number;
  presentCount: number;
  source: {
    methodReferencePath: string;
    documentedAthenaMethodCount: number;
  };
}

function isObjectLike(value: unknown): value is object {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

function ownKeys(value: object): string[] {
  const keys = new Set<string>();
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!(SKIP_OWN_KEYS.has(key) || key.startsWith("_"))) {
      keys.add(key);
    }
  }
  // Prototype methods matter for class instances (query builders, modules).
  let proto = Object.getPrototypeOf(value) as object | null;
  while (proto && proto !== Object.prototype && proto !== Function.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (!(SKIP_OWN_KEYS.has(key) || key.startsWith("_"))) {
        keys.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function resolveProperty(target: unknown, key: string): unknown {
  if (!isObjectLike(target)) {
    return;
  }
  try {
    return (target as Record<string, unknown>)[key];
  } catch {}
}

/**
 * Build seed values for documented path prefixes that require factory calls
 * (`from`, `rpc`, `select`, `update`, …) so nested methods can be inspected.
 */
function buildInspectionSeeds(client: AthenaClient): Record<string, unknown> {
  const table = client.from("sdk_surface_probe");
  const selected = (table as { select: (columns?: string) => unknown }).select(
    "id"
  );
  const updated = (
    table as { update: (values: Record<string, unknown>) => unknown }
  ).update({
    id: "probe",
  });
  const inserted = (
    table as { insert: (values: Record<string, unknown>) => unknown }
  ).insert({ id: "probe" });
  const upserted = (
    table as { upsert: (values: Record<string, unknown>) => unknown }
  ).upsert({ id: "probe" });
  const deleted = (
    table as { delete: (options?: { resourceId?: string }) => unknown }
  ).delete({ resourceId: "probe" });
  const rpc = client.rpc("sdk_surface_probe");

  return {
    athena: client,
    "athena.auth": client.auth,
    "athena.billing": client.billing,
    "athena.chat": client.chat,
    "athena.db": client.db,
    "athena.from": table,
    "athena.from.delete": deleted,
    "athena.from.insert": inserted,
    "athena.from.select": selected,
    "athena.from.update": updated,
    "athena.from.upsert": upserted,
    "athena.rpc": rpc,
    "athena.storage": client.storage,
  };
}

function resolveDocumentedPath(
  methodPath: string,
  seeds: Record<string, unknown>
): unknown {
  if (methodPath === "athena") {
    return seeds.athena;
  }

  // Prefer longest matching seed prefix so chain-local methods resolve correctly.
  const seedKeys = Object.keys(seeds)
    .filter((key) => key === methodPath || methodPath.startsWith(`${key}.`))
    .sort((a, b) => b.length - a.length);

  if (seedKeys.length === 0) {
    return;
  }

  const seedKey = seedKeys[0]!;
  let current: unknown = seeds[seedKey];
  if (seedKey === methodPath) {
    return current;
  }

  const remainder = methodPath.slice(seedKey.length + 1).split(".");
  for (const segment of remainder) {
    current = resolveProperty(current, segment);
    if (current === undefined) {
      return;
    }
  }
  return current;
}

function collectLivePaths(
  value: unknown,
  prefix: string,
  depth: number,
  maxDepth: number,
  out: Set<string>,
  seen: WeakSet<object>
): void {
  if (!isObjectLike(value) || depth > maxDepth) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const key of ownKeys(value)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    const child = resolveProperty(value, key);
    if (typeof child === "function") {
      out.add(nextPath);
      // Nested namespaces can be both callable and objects (rare); still walk props.
      if (isObjectLike(child) && ownKeys(child).length > 0) {
        collectLivePaths(child, nextPath, depth + 1, maxDepth, out, seen);
      }
      continue;
    }
    if (isObjectLike(child)) {
      out.add(nextPath);
      collectLivePaths(child, nextPath, depth + 1, maxDepth, out, seen);
    }
  }
}

export function resolveMethodReferencePath(cwd = process.cwd()): string {
  const candidates = [
    path.join(cwd, "docs", "complete-method-reference.md"),
    path.join(cwd, "..", "docs", "complete-method-reference.md"),
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "docs",
      "complete-method-reference.md"
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Could not find docs/complete-method-reference.md relative to test-sdk"
  );
}

/** Parse `| \`path\` |` rows from the generated complete method reference. */
export function parseDocumentedMethodPaths(
  methodReferencePath = resolveMethodReferencePath()
): string[] {
  const markdown = fs.readFileSync(methodReferencePath, "utf8");
  const paths: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const end = line.indexOf("`", 3);
    if (end <= 3) {
      continue;
    }
    const methodPath = line.slice(3, end).trim();
    if (methodPath && !methodPath.includes(" ")) {
      paths.push(methodPath);
    }
  }
  return paths;
}

export function listDocumentedAthenaClientMethods(
  methodReferencePath = resolveMethodReferencePath()
): string[] {
  return parseDocumentedMethodPaths(methodReferencePath).filter((methodPath) =>
    methodPath.startsWith("athena.")
  );
}

export function inspectAthenaClientSurface(
  client: AthenaClient,
  options?: {
    methodReferencePath?: string;
    /** Drop Promise thenables from required coverage (default true keeps them). */
    includePromiseMethods?: boolean;
  }
): SdkSurfaceCoverage {
  const methodReferencePath =
    options?.methodReferencePath ?? resolveMethodReferencePath();
  const includePromiseMethods = options?.includePromiseMethods ?? true;
  const documented = listDocumentedAthenaClientMethods(
    methodReferencePath
  ).filter((methodPath) => {
    if (includePromiseMethods) {
      return true;
    }
    const leaf = methodPath.split(".").at(-1) ?? "";
    return !PROMISE_METHODS.has(leaf);
  });

  const seeds = buildInspectionSeeds(client);
  const livePaths = new Set<string>();

  // Root client namespaces + factories
  collectLivePaths(client, "athena", 0, 8, livePaths, new WeakSet());
  for (const [seedPath, seedValue] of Object.entries(seeds)) {
    if (seedPath === "athena") {
      continue;
    }
    collectLivePaths(seedValue, seedPath, 0, 6, livePaths, new WeakSet());
  }

  const statuses: SdkSurfaceMethodStatus[] = documented.map((methodPath) => {
    const resolved = resolveDocumentedPath(methodPath, seeds);
    if (resolved === undefined) {
      return { kind: "missing", path: methodPath, present: false };
    }
    if (typeof resolved === "function") {
      return { kind: "function", path: methodPath, present: true };
    }
    if (isObjectLike(resolved)) {
      return { kind: "object", path: methodPath, present: true };
    }
    return { kind: "other", path: methodPath, present: true };
  });

  const missing = statuses
    .filter((status) => !status.present)
    .map((status) => status.path);

  return {
    documented: statuses,
    livePaths: [...livePaths].sort((a, b) => a.localeCompare(b)),
    missing,
    missingCount: missing.length,
    presentCount: statuses.length - missing.length,
    source: {
      documentedAthenaMethodCount: documented.length,
      methodReferencePath,
    },
  };
}

export function buildSdkSurfaceReport(client: AthenaClient) {
  const coverage = inspectAthenaClientSurface(client);
  const table = client.from("sdk_surface_probe") as unknown as Record<
    string,
    unknown
  >;
  const rpc = client.rpc("sdk_surface_probe") as unknown as Record<
    string,
    unknown
  >;

  const methodPresence = (target: Record<string, unknown>, names: string[]) =>
    Object.fromEntries(
      names.map((name) => [name, typeof target[name] === "function"])
    );

  return {
    constructors: {
      browser: "createAthenaBrowserClient",
      server: "createAthenaServerClient",
    },
    coverage: {
      complete: coverage.missingCount === 0,
      documentedAthenaMethodCount: coverage.source.documentedAthenaMethodCount,
      methodReferencePath: coverage.source.methodReferencePath,
      missing: coverage.missing,
      missingCount: coverage.missingCount,
      presentCount: coverage.presentCount,
    },
    documented: coverage.documented,
    livePaths: coverage.livePaths,
    methods: {
      ...methodPresence(table, [
        "findMany",
        "upsert",
        "insert",
        "update",
        "delete",
        "select",
        "maybeSingle",
        "single",
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "like",
        "ilike",
        "is",
        "in",
        "match",
        "not",
        "or",
        "contains",
        "containedBy",
        "order",
        "limit",
        "offset",
        "range",
        "pageSize",
        "currentPage",
        "totalPages",
        "reset",
        "eqCast",
        "eqUuid",
      ]),
      rpc: methodPresence(rpc, [
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "like",
        "ilike",
        "is",
        "in",
        "order",
        "limit",
        "offset",
        "range",
        "select",
        "single",
        "maybeSingle",
      ]),
    },
    namespaces: {
      auth: typeof client.auth === "object",
      billing: typeof client.billing === "object",
      capabilities: typeof client.capabilities === "object",
      chat: typeof client.chat === "object",
      db: typeof client.db === "object",
      from: typeof client.from === "function",
      query: typeof client.query === "function",
      request: typeof client.request === "function",
      rpc: typeof client.rpc === "function",
      storage: typeof client.storage === "object",
      verifyConnection: typeof client.verifyConnection === "function",
      withContext: typeof client.withContext === "function",
    },
  };
}
