import * as z from "zod";

export const DOCS_API_V3 = "athena/docs-api/v3" as const;
export const DOCS_API_V3_SEMANTIC = `${DOCS_API_V3}/semantic` as const;
export const DOCS_API_V3_BINDINGS = `${DOCS_API_V3}/bindings` as const;
export const DOCS_API_V3_SYMBOLS = `${DOCS_API_V3}/symbols` as const;
export const DOCS_API_V3_EXAMPLES = `${DOCS_API_V3}/examples` as const;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const runtimeValueSchema = z.enum(["supported", "unsupported", "unknown"]);
const runtimeSchema = z.strictObject({
  browser: runtimeValueSchema,
  node: runtimeValueSchema,
  reactNative: runtimeValueSchema,
  workerd: runtimeValueSchema,
});

const provenanceInputSchema = z.strictObject({
  digest: digestSchema,
  id: z.string().min(1),
  kind: z.string().min(1),
});
const provenanceSchema = z.strictObject({
  inputs: z.array(provenanceInputSchema),
});

export type DocsAuthorizationExpression =
  | { op: "right"; key: string }
  | { op: "all"; terms: DocsAuthorizationExpression[] }
  | { op: "any"; terms: DocsAuthorizationExpression[] }
  | { op: "not"; term: DocsAuthorizationExpression };

const authorizationExpressionSchema: z.ZodType<DocsAuthorizationExpression> =
  z.lazy(() =>
    z.discriminatedUnion("op", [
      z.strictObject({ key: z.string().min(1), op: z.literal("right") }),
      z.strictObject({
        op: z.literal("all"),
        terms: z.array(authorizationExpressionSchema).min(1),
      }),
      z.strictObject({
        op: z.literal("any"),
        terms: z.array(authorizationExpressionSchema).min(1),
      }),
      z.strictObject({
        op: z.literal("not"),
        term: authorizationExpressionSchema,
      }),
    ])
  );

const authorizationSchema = z.strictObject({
  condition: authorizationExpressionSchema.optional(),
  principal: z.enum([
    "public",
    "optional-session",
    "session",
    "admin-session",
    "protocol",
  ]),
  scope: z
    .strictObject({
      kind: z.enum(["platform", "organization", "resource"]),
      membership: z.literal("required").optional(),
    })
    .optional(),
});

export const docsTransportSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("http"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("websocket"),
    path: z.string().min(1).optional(),
    protocol: z.string().min(1),
  }),
  z.strictObject({
    capability: z.string().min(1),
    kind: z.literal("mcp"),
  }),
  z.strictObject({ kind: z.literal("local") }),
]);
const realizationSchema = z.strictObject({
  lifecycle: z.enum(["canonical", "compatibility", "deprecated"]).optional(),
  runtime: z.enum(["embedded", "dedicated"]),
  status: z.enum(["supported", "unsupported", "partial", "unknown"]),
});
const typeRefSchema = z.strictObject({ symbolId: z.string().min(1) });

const domainSchema = z.strictObject({
  id: z.string().min(1),
  provenance: provenanceSchema,
  summary: z.string().optional(),
  title: z.string().min(1),
});
const conceptSchema = z.strictObject({
  domainId: z.string().min(1),
  id: z.string().min(1),
  kind: z.enum([
    "resource",
    "identity",
    "policy",
    "protocol",
    "feature",
    "actor",
  ]),
  provenance: provenanceSchema,
  relationships: z.array(
    z.strictObject({
      kind: z.enum(["owned-by", "distinct-from", "related-to"]),
      targetId: z.string().min(1),
    })
  ),
  security: z
    .strictObject({
      credentialStorage: z.enum(["external-reference", "managed"]),
      secretField: z.string().min(1).optional(),
    })
    .optional(),
  summary: z.string().min(1),
  title: z.string().min(1),
});
const operationSchema = z.strictObject({
  authorization: authorizationSchema.optional(),
  bindingIds: z.array(z.string().min(1)),
  capabilityRefs: z.array(z.strictObject({ id: z.string().min(1) })),
  conceptIds: z.array(z.string()),
  domainId: z.string().min(1),
  errorRefs: z.array(z.string().min(1)),
  id: z.string().min(1),
  input: typeRefSchema.optional(),
  kind: z.enum([
    "read",
    "create",
    "update",
    "delete",
    "action",
    "protocol",
    "stream",
    "pure",
  ]),
  lifecycle: z.strictObject({
    replacementOperationId: z.string().min(1).optional(),
    status: z.enum(["canonical", "compatibility", "deprecated"]),
  }),
  output: typeRefSchema.optional(),
  provenance: provenanceSchema,
  realizations: z.array(realizationSchema),
  summary: z.string().min(1),
  title: z.string().min(1),
  transports: z.array(docsTransportSchema),
});
const errorSchema = z.strictObject({
  code: z.string().min(1),
  description: z.string().min(1),
  domain: z.enum([
    "auth",
    "billing",
    "chat",
    "data",
    "gateway",
    "internal",
    "notifications",
    "policy",
    "storage",
    "webhook",
  ]),
  errorNumber: z.number().int().positive(),
  kind: z.enum([
    "authentication",
    "authorization",
    "conflict",
    "customer_action_required",
    "internal",
    "not_found",
    "rate_limited",
    "unsupported",
    "unavailable",
    "validation",
    "unknown",
  ]),
  provenance: provenanceSchema,
  retry: z.enum([
    "never",
    "safe",
    "reconcile_first",
    "customer_action_required",
  ]),
  status: z.number().int().min(100).max(599),
});
const capabilitySchema = z.strictObject({
  domain: z.enum([
    "data",
    "auth",
    "storage",
    "billing",
    "chat",
    "notifications",
  ]),
  id: z.string().min(1),
  implementation: z.enum([
    "native",
    "proxied",
    "emulated",
    "unsupported",
    "unknown",
  ]),
  kind: z.enum(["operation", "feature", "semantic"]),
  maturity: z.enum(["stable", "preview", "disabled"]),
  provenance: provenanceSchema,
  status: z.enum(["available", "unavailable", "degraded", "unknown"]),
});

const semanticSchema = z.strictObject({
  capabilities: z.array(capabilitySchema),
  concepts: z.array(conceptSchema),
  domains: z.array(domainSchema),
  errors: z.array(errorSchema),
  operations: z.array(operationSchema),
  schema: z.literal(DOCS_API_V3_SEMANTIC),
});

const bindingSchema = z.strictObject({
  deprecated: z.boolean(),
  frameworks: z.array(z.string()),
  id: z.string().min(1),
  importPath: z.string().min(1),
  language: z.literal("typescript"),
  operationId: z.string().min(1).optional(),
  package: z.string().min(1),
  replacementBindingId: z.string().min(1).optional(),
  runtime: runtimeSchema,
  signature: z.string(),
  source: z.string().nullable(),
  symbolPath: z.string().min(1),
});
const bindingsDocumentSchema = z.strictObject({
  bindings: z.array(bindingSchema),
  schema: z.literal(DOCS_API_V3_BINDINGS),
});

const symbolSchema = z.strictObject({
  bindingIds: z.array(z.string().min(1)),
  classification: z.enum([
    "documented",
    "reference",
    "public-unlisted",
    "exempt",
    "unknown",
  ]),
  deprecated: z.boolean(),
  examples: z.array(z.string()),
  id: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  related: z.array(z.string()),
  replacement: z.string().optional(),
  source: z.string().nullable(),
  summary: z.string(),
  tags: z.strictObject({
    canonical: z.boolean().optional(),
    category: z.string().optional(),
    role: z.string().optional(),
    runtime: z.array(z.string()).optional(),
    since: z.string().optional(),
  }),
});
const symbolsDocumentSchema = z.strictObject({
  schema: z.literal(DOCS_API_V3_SYMBOLS),
  symbols: z.array(symbolSchema),
});
const exampleSchema = z.strictObject({
  entrypoint: z.string().optional(),
  file: z.string().min(1),
  id: z.string().min(1),
  operationIds: z.array(z.string().min(1)),
  path: z.string().optional(),
  symbolIds: z.array(z.string().min(1)),
  title: z.string().optional(),
});
const examplesDocumentSchema = z.strictObject({
  examples: z.array(exampleSchema),
  schema: z.literal(DOCS_API_V3_EXAMPLES),
});

export const docsApiManifestV3Schema = z.strictObject({
  artifacts: z.strictObject({
    bindings: z.literal("bindings.v3.json"),
    examples: z.literal("examples.v3.json"),
    semantic: z.literal("semantic.v3.json"),
    symbols: z.literal("symbols.v3.json"),
  }),
  package: z.strictObject({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  schema: z.literal(DOCS_API_V3),
  source: z.strictObject({
    inputsDigest: digestSchema,
    packageJsonDigest: digestSchema,
  }),
});

export const docsApiV3ArtifactsSchema = z.strictObject({
  bindings: bindingsDocumentSchema,
  examples: examplesDocumentSchema,
  manifest: docsApiManifestV3Schema,
  semantic: semanticSchema,
  symbols: symbolsDocumentSchema,
});

export type DocsApiManifestV3 = z.infer<typeof docsApiManifestV3Schema>;
export type DocsTransport = z.infer<typeof docsTransportSchema>;
export type DocsOperation = z.infer<typeof operationSchema>;
export type DocsBinding = z.infer<typeof bindingSchema>;
export type DocsApiV3Artifacts = z.infer<typeof docsApiV3ArtifactsSchema>;

export function parseDocsApiManifestV3(input: unknown): DocsApiManifestV3 {
  return docsApiManifestV3Schema.parse(input);
}

export function docsApiV3JsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(docsApiV3ArtifactsSchema, {
    io: "input",
    target: "draft-2020-12",
  }) as Record<string, unknown>;
}

export interface DocsApiV3Authorities {
  expectedPackageJsonDigest?: string;
  inputDigests: ReadonlyMap<string, string>;
  rightKeys: ReadonlySet<string>;
}

function uniqueIds(
  values: readonly string[],
  label: string,
  errors: string[]
): Set<string> {
  const ids = new Set<string>();
  for (const id of values) {
    if (ids.has(id)) {
      errors.push(`duplicate ${label} id: ${id}`);
    }
    ids.add(id);
  }
  return ids;
}

function collectRightKeys(value: unknown, keys: string[]): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRightKeys(item, keys);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.op === "right" && typeof record.key === "string") {
    keys.push(record.key);
  }
  for (const nested of Object.values(record)) {
    collectRightKeys(nested, keys);
  }
}

function validateDocsApiV3Internal(
  input: unknown,
  authorities?: DocsApiV3Authorities
): DocsApiV3Artifacts {
  const artifacts = docsApiV3ArtifactsSchema.parse(input);
  const errors: string[] = [];
  const { manifest, semantic, bindings, symbols, examples } = artifacts;
  const domains = uniqueIds(
    semantic.domains.map((item) => item.id),
    "domain",
    errors
  );
  const concepts = uniqueIds(
    semantic.concepts.map((item) => item.id),
    "concept",
    errors
  );
  const operations = uniqueIds(
    semantic.operations.map((item) => item.id),
    "operation",
    errors
  );
  const bindingIds = uniqueIds(
    bindings.bindings.map((item) => item.id),
    "binding",
    errors
  );
  const symbolIds = uniqueIds(
    symbols.symbols.map((item) => item.id),
    "symbol",
    errors
  );
  const errorCodes = uniqueIds(
    semantic.errors.map((item) => item.code),
    "error",
    errors
  );
  const capabilityIds = uniqueIds(
    semantic.capabilities.map((item) => item.id),
    "capability",
    errors
  );
  uniqueIds(
    examples.examples.map((item) => item.id),
    "example",
    errors
  );

  if (
    authorities?.expectedPackageJsonDigest != null &&
    manifest.source.packageJsonDigest !== authorities.expectedPackageJsonDigest
  ) {
    errors.push("manifest packageJsonDigest does not match package.json");
  }
  for (const [id, expected] of authorities?.inputDigests ?? []) {
    if (id === "manifest-inputs" && manifest.source.inputsDigest !== expected) {
      errors.push("manifest inputsDigest does not match current inputs");
    }
  }

  for (const concept of semantic.concepts) {
    if (!domains.has(concept.domainId)) {
      errors.push(
        `concept ${concept.id} references unknown domain ${concept.domainId}`
      );
    }
    for (const relation of concept.relationships) {
      if (!concepts.has(relation.targetId)) {
        errors.push(
          `concept ${concept.id} references unknown concept ${relation.targetId}`
        );
      }
    }
  }
  const rightKeys: string[] = [];
  for (const operation of semantic.operations) {
    if (!domains.has(operation.domainId)) {
      errors.push(
        `operation ${operation.id} references unknown domain ${operation.domainId}`
      );
    }
    for (const conceptId of operation.conceptIds) {
      if (!concepts.has(conceptId)) {
        errors.push(
          `operation ${operation.id} references unknown concept ${conceptId}`
        );
      }
    }
    for (const bindingId of operation.bindingIds) {
      const binding = bindings.bindings.find((item) => item.id === bindingId);
      if (!bindingIds.has(bindingId)) {
        errors.push(
          `operation ${operation.id} references unknown binding ${bindingId}`
        );
      } else if (binding?.operationId !== operation.id) {
        errors.push(
          `binding ${bindingId} does not reference operation ${operation.id}`
        );
      }
    }
    for (const errorRef of operation.errorRefs) {
      if (!errorCodes.has(errorRef)) {
        errors.push(
          `operation ${operation.id} references unknown error ${errorRef}`
        );
      }
    }
    for (const capability of operation.capabilityRefs) {
      if (!capabilityIds.has(capability.id)) {
        errors.push(
          `operation ${operation.id} references unknown capability ${capability.id}`
        );
      }
    }
    if (operation.input && !symbolIds.has(operation.input.symbolId)) {
      errors.push(
        `operation ${operation.id} input references unknown symbol ${operation.input.symbolId}`
      );
    }
    if (operation.output && !symbolIds.has(operation.output.symbolId)) {
      errors.push(
        `operation ${operation.id} output references unknown symbol ${operation.output.symbolId}`
      );
    }
    if (
      operation.lifecycle.replacementOperationId &&
      !operations.has(operation.lifecycle.replacementOperationId)
    ) {
      errors.push(
        `operation ${operation.id} references unknown replacement ${operation.lifecycle.replacementOperationId}`
      );
    }
    collectRightKeys(operation.authorization?.condition, rightKeys);
  }
  if (authorities != null) {
    for (const key of rightKeys) {
      if (!authorities.rightKeys.has(key)) {
        errors.push(`unknown Right key: ${key}`);
      }
    }
  }
  for (const binding of bindings.bindings) {
    if (Object.values(binding.runtime).includes("unknown")) {
      errors.push(
        `binding ${binding.id} has an unknown runtime classification`
      );
    }
    if (binding.operationId) {
      const operation = semantic.operations.find(
        (item) => item.id === binding.operationId
      );
      if (!operation) {
        errors.push(
          `binding ${binding.id} references unknown operation ${binding.operationId}`
        );
      } else if (!operation.bindingIds.includes(binding.id)) {
        errors.push(
          `binding ${binding.id} is not listed by operation ${binding.operationId}`
        );
      }
    }
    if (
      binding.replacementBindingId &&
      !bindingIds.has(binding.replacementBindingId)
    ) {
      errors.push(
        `binding ${binding.id} references unknown replacement ${binding.replacementBindingId}`
      );
    }
  }
  if (authorities != null) {
    for (const record of [
      ...semantic.domains,
      ...semantic.concepts,
      ...semantic.operations,
      ...semantic.errors,
      ...semantic.capabilities,
    ]) {
      for (const input of record.provenance.inputs) {
        const expected = authorities.inputDigests.get(input.id);
        if (expected == null) {
          errors.push(
            `semantic record references unknown provenance input ${input.id}`
          );
        } else if (expected !== input.digest) {
          errors.push(
            `semantic record has stale provenance digest for ${input.id}`
          );
        }
      }
    }
  }
  for (const symbol of symbols.symbols) {
    for (const bindingId of symbol.bindingIds) {
      if (!bindingIds.has(bindingId)) {
        errors.push(
          `symbol ${symbol.id} references unknown binding ${bindingId}`
        );
      }
    }
  }
  for (const example of examples.examples) {
    for (const symbolId of example.symbolIds) {
      if (!symbolIds.has(symbolId)) {
        errors.push(
          `example ${example.id} references unknown symbol ${symbolId}`
        );
      }
    }
    for (const operationId of example.operationIds) {
      if (!operations.has(operationId)) {
        errors.push(
          `example ${example.id} references unknown operation ${operationId}`
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Docs API IR v3 validation failed:\n${errors.map((error) => `- ${error}`).join("\n")}`
    );
  }
  return artifacts;
}

export function parseDocsApiV3Artifacts(input: unknown): DocsApiV3Artifacts {
  return validateDocsApiV3Internal(input);
}

export function validateDocsApiV3(
  input: unknown,
  authorities: DocsApiV3Authorities
): DocsApiV3Artifacts {
  return validateDocsApiV3Internal(input, authorities);
}
