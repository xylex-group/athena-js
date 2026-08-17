/**
 * Canonical Athena gateway route descriptors for SDK route selection.
 *
 * Classifications mirror `docs/release/athena-5-route-manifest.json`.
 * Do not invent a second handwritten sunset policy — keep this table aligned
 * with the monorepo manifest when either changes.
 */

export type AthenaRouteClassification =
  | "Retain"
  | "Migrate"
  | "Deprecate"
  | "Remove"
  | "Internalize"
  | "Replace";

export type AthenaRouteStatus = "retained" | "deprecated" | "removed";

export interface AthenaRouteDescriptor {
  classification: AthenaRouteClassification;
  methods: readonly string[];
  path: string;
  protocol: number;
  reason: string;
  replacement: string | null;
  status: AthenaRouteStatus;
}

function classificationToStatus(
  classification: AthenaRouteClassification
): AthenaRouteStatus {
  if (classification === "Deprecate" || classification === "Migrate") {
    return "deprecated";
  }
  if (classification === "Remove") {
    return "removed";
  }
  return "retained";
}

/** Structured CRUD + raw query paths used by the JS SDK. */
export const ATHENA_GATEWAY_ROUTES = {
  delete: "/gateway/delete",
  health: "/health",
  insert: "/gateway/insert",
  rawQuery: "/gateway/query",
  root: "/",
  rpc: "/gateway/rpc",
  select: "/gateway/fetch",
  update: "/gateway/update",
} as const;

export type AthenaGatewayRouteKey = keyof typeof ATHENA_GATEWAY_ROUTES;

/**
 * Inventory sourced from docs/release/athena-5-route-manifest.json (gateway + health).
 * Keep in sync when the monorepo manifest changes.
 */
export const ATHENA_ROUTE_MANIFEST: readonly AthenaRouteDescriptor[] = [
  {
    classification: "Retain",
    methods: ["POST", "GET"],
    path: "/gateway/fetch",
    protocol: 1,
    reason: "Canonical structured read API",
    replacement: null,
    status: classificationToStatus("Retain"),
  },
  {
    classification: "Retain",
    methods: ["POST"],
    path: "/gateway/insert",
    protocol: 1,
    reason: "Canonical write API",
    replacement: null,
    status: classificationToStatus("Retain"),
  },
  {
    classification: "Retain",
    methods: ["POST"],
    path: "/gateway/update",
    protocol: 1,
    reason: "Canonical update API",
    replacement: null,
    status: classificationToStatus("Retain"),
  },
  {
    classification: "Retain",
    methods: ["POST"],
    path: "/gateway/delete",
    protocol: 1,
    reason: "Canonical delete API",
    replacement: null,
    status: classificationToStatus("Retain"),
  },
  {
    classification: "Deprecate",
    methods: ["POST"],
    path: "/gateway/query",
    protocol: 1,
    reason:
      "Raw SQL is harder to secure and bypasses structured metadata ownership",
    replacement:
      "Structured /gateway/fetch|insert|update|delete with compiled statements",
    status: classificationToStatus("Deprecate"),
  },
  {
    classification: "Retain",
    methods: ["GET"],
    path: "/health",
    protocol: 1,
    reason: "Diagnostics surface; Athena 5 adds release identity",
    replacement: null,
    status: classificationToStatus("Retain"),
  },
] as const;

export function getAthenaRouteDescriptor(
  path: string
): AthenaRouteDescriptor | undefined {
  return ATHENA_ROUTE_MANIFEST.find((route) => route.path === path);
}

export function isDeprecatedAthenaRoute(path: string): boolean {
  return getAthenaRouteDescriptor(path)?.status === "deprecated";
}
