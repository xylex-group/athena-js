import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAthenaAuthorizationRightsIr } from "../../../src/runtime/authorization/catalog.ts";
import { type DocsApiIr, extractDocsApi } from "../extract-api.mts";
import {
  DOCS_API_V3,
  DOCS_API_V3_BINDINGS,
  DOCS_API_V3_EXAMPLES,
  DOCS_API_V3_SEMANTIC,
  DOCS_API_V3_SYMBOLS,
  type DocsApiV3Artifacts,
  type DocsApiV3Authorities,
  type DocsBinding,
  docsApiV3JsonSchema,
  parseDocsApiV3Artifacts,
  validateDocsApiV3,
} from "./schema.mts";

const ARTIFACTS = {
  bindings: "bindings.v3.json",
  examples: "examples.v3.json",
  semantic: "semantic.v3.json",
  symbols: "symbols.v3.json",
} as const;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStable(left, right))
      .map(([key, nested]) => [key, canonical(nested)])
  );
}

export function stableDocsApiV3Stringify(value: unknown): string {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function canonicalDocsApiV3RightKeys(): ReadonlySet<string> {
  return new Set(getAthenaAuthorizationRightsIr().rights.map(({ key }) => key));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function flattenSymbols(ir: DocsApiIr): Array<{
  entrypoint: DocsApiIr["entrypoints"][number];
  symbol: DocsApiIr["entrypoints"][number]["symbols"][number];
}> {
  return ir.entrypoints.flatMap((entrypoint) =>
    entrypoint.symbols.map((symbol) => ({ entrypoint, symbol }))
  );
}

function toBinding(
  entrypoint: DocsApiIr["entrypoints"][number],
  symbol: DocsApiIr["entrypoints"][number]["symbols"][number],
  packageName: string
): DocsBinding {
  return {
    deprecated: symbol.deprecated,
    frameworks: [...entrypoint.framework].sort(compareStable),
    id: symbol.id,
    importPath: entrypoint.importPath,
    language: "typescript",
    package: packageName,
    runtime: entrypoint.runtime,
    signature: symbol.signature,
    source: symbol.source,
    symbolPath: symbol.name,
  };
}

function toSymbolIds(ir: DocsApiIr, refs: readonly string[]): string[] {
  return refs.map((ref) => {
    const matches = flattenSymbols(ir).filter(
      ({ symbol }) => symbol.id === ref || symbol.name === ref
    );
    const match = matches[0];
    if (matches.length !== 1 || match == null) {
      throw new Error(
        `Docs example reference "${ref}" resolves to ${matches.length} public symbols; use an unambiguous symbol reference`
      );
    }
    return match.symbol.id;
  });
}

export function composeDocsApiV3(
  packageRoot: string,
  ir: DocsApiIr = extractDocsApi(packageRoot)
): DocsApiV3Artifacts {
  const rows = flattenSymbols(ir);
  const bindings = rows
    .map(({ entrypoint, symbol }) =>
      toBinding(entrypoint, symbol, ir.package.name)
    )
    .sort((left, right) => compareStable(left.id, right.id));
  const symbols = rows
    .map(({ symbol }) => ({
      classification: symbol.classification,
      deprecated: symbol.deprecated,
      id: symbol.id,
      kind: symbol.kind,
      name: symbol.name,
      summary: symbol.summary,
      ...(symbol.replacement ? { replacement: symbol.replacement } : {}),
      bindingIds: [symbol.id],
      examples: [...symbol.examples].sort(compareStable),
      related: [...symbol.related].sort(compareStable),
      source: symbol.source,
      tags: symbol.tags,
    }))
    .sort((left, right) => compareStable(left.id, right.id));
  const examples = ir.examples
    .map((example) => ({
      ...example,
      operationIds: [],
      symbolIds: toSymbolIds(ir, example.symbolIds).sort(compareStable),
    }))
    .sort((left, right) => compareStable(left.id, right.id));
  const inputsDigest = sha256(
    stableDocsApiV3Stringify({
      inputs: ir,
      packageJsonDigest: ir.source.packageJsonDigest,
    })
  );
  const artifacts = {
    bindings: { bindings, schema: DOCS_API_V3_BINDINGS },
    examples: { examples, schema: DOCS_API_V3_EXAMPLES },
    manifest: {
      artifacts: { ...ARTIFACTS },
      package: { ...ir.package },
      schema: DOCS_API_V3,
      source: {
        inputsDigest,
        packageJsonDigest: ir.source.packageJsonDigest,
      },
    },
    semantic: {
      capabilities: [],
      concepts: [],
      domains: [],
      errors: [],
      operations: [],
      schema: DOCS_API_V3_SEMANTIC,
    },
    symbols: { schema: DOCS_API_V3_SYMBOLS, symbols },
  };
  return validateDocsApiV3(artifacts, {
    expectedPackageJsonDigest: ir.source.packageJsonDigest,
    inputDigests: new Map([["manifest-inputs", inputsDigest]]),
    rightKeys: canonicalDocsApiV3RightKeys(),
  });
}

export function writeDocsApiV3(
  packageRoot: string,
  artifacts: DocsApiV3Artifacts
): void {
  const generated = join(packageRoot, "docs", "generated");
  mkdirSync(generated, { recursive: true });
  writeFileSync(
    join(generated, "semantic.v3.json"),
    stableDocsApiV3Stringify(artifacts.semantic)
  );
  writeFileSync(
    join(generated, "bindings.v3.json"),
    stableDocsApiV3Stringify(artifacts.bindings)
  );
  writeFileSync(
    join(generated, "symbols.v3.json"),
    stableDocsApiV3Stringify(artifacts.symbols)
  );
  writeFileSync(
    join(generated, "examples.v3.json"),
    stableDocsApiV3Stringify(artifacts.examples)
  );
  writeFileSync(
    join(generated, "manifest.v3.json"),
    stableDocsApiV3Stringify(artifacts.manifest)
  );
  writeFileSync(
    join(
      packageRoot,
      "..",
      "..",
      "docs",
      "contracts",
      "docs-api.v3.schema.json"
    ),
    stableDocsApiV3Stringify(docsApiV3JsonSchema())
  );
}

export function checkDocsApiV3(
  packageRoot: string,
  artifacts: DocsApiV3Artifacts
): string[] {
  const generated = join(packageRoot, "docs", "generated");
  const expected = new Map<string, unknown>([
    ["semantic.v3.json", artifacts.semantic],
    ["bindings.v3.json", artifacts.bindings],
    ["symbols.v3.json", artifacts.symbols],
    ["examples.v3.json", artifacts.examples],
    ["manifest.v3.json", artifacts.manifest],
  ]);
  const drift: string[] = [];
  for (const [file, value] of expected) {
    const path = join(generated, file);
    try {
      if (readFileSync(path, "utf8") !== stableDocsApiV3Stringify(value)) {
        drift.push(`docs/generated/${file}`);
      }
    } catch {
      drift.push(`docs/generated/${file} (missing)`);
    }
  }
  const schemaPath = join(
    packageRoot,
    "..",
    "..",
    "docs",
    "contracts",
    "docs-api.v3.schema.json"
  );
  try {
    if (
      readFileSync(schemaPath, "utf8") !==
      stableDocsApiV3Stringify(docsApiV3JsonSchema())
    ) {
      drift.push("docs/contracts/docs-api.v3.schema.json");
    }
  } catch {
    drift.push("docs/contracts/docs-api.v3.schema.json (missing)");
  }
  return drift;
}

function readDocsApiV3Input(packageRoot: string): unknown {
  const generated = join(packageRoot, "docs", "generated");
  const read = (file: string) =>
    JSON.parse(readFileSync(join(generated, file), "utf8")) as unknown;
  return {
    bindings: read("bindings.v3.json"),
    examples: read("examples.v3.json"),
    manifest: read("manifest.v3.json"),
    semantic: read("semantic.v3.json"),
    symbols: read("symbols.v3.json"),
  };
}

export function readDocsApiV3Structurally(
  packageRoot: string
): DocsApiV3Artifacts {
  return parseDocsApiV3Artifacts(readDocsApiV3Input(packageRoot));
}

export function readValidatedDocsApiV3Artifacts(
  packageRoot: string,
  authorities: DocsApiV3Authorities
): DocsApiV3Artifacts {
  return validateDocsApiV3(readDocsApiV3Input(packageRoot), authorities);
}

export function packageRootFromCli(metaUrl: string): string {
  return dirname(dirname(dirname(dirname(fileURLToPath(metaUrl)))));
}
