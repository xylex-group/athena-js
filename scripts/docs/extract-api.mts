import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

import {
  packageJsonDigest,
  readPackageJson,
  resolvePublishedExports,
  type ResolvedExport,
} from "./extract-exports.mts";

export type DocsApiSymbolClassification =
  | "documented"
  | "reference"
  | "public-unlisted"
  | "exempt"
  | "unknown";

export type DocsExemption = {
  id: string;
  reason: string;
  owner?: string;
  category?: string;
};
export type DocsApiSymbol = {
  id: string;
  name: string;
  kind: string;
  classification: DocsApiSymbolClassification;
  signature: string;
  summary: string;
  deprecated: boolean;
  replacement?: string;
  source: string | null;
  examples: string[];
  related: string[];
  requires: string[];
  forbids: string[];
  runtime?: ResolvedExport["runtime"];
  tags: {
    canonical?: boolean;
    since?: string;
    role?: string;
    category?: string;
    runtime?: string[];
  };
  semantic?: {
    error?: {
      codes: string[];
      errorNumbers: number[];
      subsystem: string;
      retry: "never" | "safe" | "reconcile_first" | "customer_action_required";
    };
    authorization?: {
      requiredRights: string[];
      forbiddenRights: string[];
      scope?: string;
    };
    capabilities?: string[];
  };
};
type DocsRetryDisposition =
  | "never"
  | "safe"
  | "reconcile_first"
  | "customer_action_required";

export type DocsApiEntrypoint = {
  importPath: string;
  exportKey: string;
  runtime: ResolvedExport["runtime"];
  runtimeClassification: ResolvedExport["runtimeClassification"];
  framework: string[];
  source: string | null;
  kind: "module" | "css" | "skipped";
  symbols: DocsApiSymbol[];
};

export type DocsApiExample = {
  id: string;
  file: string;
  symbolIds: string[];
  entrypoint?: string;
  path?: string;
  title?: string;
};

export type DocsApiIr = {
  schema: "athena/docs-api/v2";
  package: { name: string; version: string };
  source: { packageJsonDigest: string };
  entrypoints: DocsApiEntrypoint[];
  examples: DocsApiExample[];
  errors: Array<{
    code: string;
    errorNumber: number;
    subsystem: string;
    retry: DocsRetryDisposition;
    description: string;
    docsUrl: string | null;
  }>;
};

export type DocsExemptions = {
  exportKeys?: DocsExemption[];
  symbols?: DocsExemption[];
};

function exemptionIdSet(items: DocsExemption[] | undefined): Set<string> {
  return new Set((items ?? []).map((item) => item.id));
}

const MAX_MEMBER_DEPTH = 6;
const MAX_MEMBERS_PER_ENTRY = 800;
const SKIP_MEMBER_NAMES = new Set([
  "__@toStringTag",
  "catch",
  "constructor",
  "finally",
  "then",
  "toJSON",
  "toString",
  "valueOf",
]);

type OverlayMap = Record<
  string,
  { summary?: string; category?: string; notes?: string[] }
>;

function loadJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function loadOverlay(packageRoot: string): OverlayMap {
  const jsonPath = join(packageRoot, "src", "docs", "api-summaries.json");
  return loadJson<OverlayMap>(jsonPath, {});
}

function loadErrorRegistry(packageRoot: string): DocsApiIr["errors"] {
  const contractsRoot = join(packageRoot, "..", "..", "contracts");
  const records: DocsApiIr["errors"] = [];
  if (!existsSync(contractsRoot)) return records;
  for (const domainDirectory of readdirSync(contractsRoot, { withFileTypes: true })) {
    if (!domainDirectory.isDirectory()) continue;
    const file = join(contractsRoot, domainDirectory.name, "errors.json");
    if (!existsSync(file)) continue;
    const payload = loadJson<{ codes?: Array<Record<string, unknown>> }>(file, {});
    const subsystem = domainDirectory.name === "webhooks" ? "webhook" : domainDirectory.name;
    for (const item of payload.codes ?? []) {
      const rawCode = typeof item.code === "string" ? item.code : "";
      const code = rawCode ? `${subsystem}_` + rawCode : "";
      const errorNumber = typeof item.errorNumber === "number" ? item.errorNumber : NaN;
      const status = typeof item.status === "number" ? item.status : undefined;
      const retry = item.retry ?? inferRetry(rawCode, status);
      const description = typeof item.description === "string" ? item.description : "";
      if (
        !code ||
        !Number.isInteger(errorNumber) ||
        !["never", "safe", "reconcile_first", "customer_action_required"].includes(String(retry))
      ) continue;
      records.push({
        code: `ATHENA_${code.toUpperCase()}`,
        errorNumber,
        subsystem,
        retry: retry as DocsRetryDisposition,
        description,
        docsUrl: null,
      });
    }
  }
  return records.sort((left, right) => left.errorNumber - right.errorNumber);
}

function inferRetry(code: string, status: number | undefined): DocsRetryDisposition {
  const lower = code.toLowerCase();
  if (
    status !== undefined &&
    status >= 500 &&
    /(unavailable|timeout|connection|network)/.test(lower)
  ) {
    return "safe";
  }
  if (status === 429) {
    return "safe";
  }
  return "never";
}

function loadSidecarDocs(
  packageRoot: string,
  sourceFile: string
): OverlayMap {
  const sidecar = sourceFile.replace(/\.(tsx?)$/, ".docs.ts");
  const full = join(packageRoot, sidecar);
  if (!existsSync(full)) {
    return {};
  }
  const text = readFileSync(full, "utf8");
  const map: OverlayMap = {};
  const block = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
  for (const match of text.matchAll(block)) {
    map[match[1]] = { summary: match[2] };
  }
  return map;
}

function tagText(symbol: ts.Symbol, name: string): string {
  const tag = symbol.getJsDocTags().find((item) => item.name === name);
  if (!tag) {
    return "";
  }
  const text = tag.text;
  if (typeof text === "string") {
    return text.trim();
  }
  if (!Array.isArray(text)) {
    return "";
  }
  return text
    .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTag(symbol: ts.Symbol, name: string): boolean {
  return symbol.getJsDocTags().some((item) => item.name === name);
}

function documentation(checker: ts.TypeChecker, symbol: ts.Symbol): string {
  return ts
    .displayPartsToString(symbol.getDocumentationComment(checker))
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSignature(signature: string): string {
  return signature
    .replace(/import\("[^"]+"\)\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLocalDeclaration(packageRoot: string, decl: ts.Declaration | undefined): boolean {
  if (!decl) {
    return false;
  }
  const file = decl.getSourceFile().fileName.replace(/\\/g, "/");
  const root = packageRoot.replace(/\\/g, "/");
  return file.startsWith(`${root}/src/`) || file.includes("/src/");
}

function relativeSource(packageRoot: string, decl: ts.Declaration | undefined): string | null {
  if (!decl) {
    return null;
  }
  return relative(packageRoot, decl.getSourceFile().fileName).replace(/\\/g, "/");
}

function classifyKind(
  name: string,
  flags: ts.SymbolFlags,
  callCount: number,
  overlayCategory?: string
): string {
  if (overlayCategory) {
    return overlayCategory;
  }
  if (/^use[A-Z]/.test(name)) {
    return "hook";
  }
  if (name.endsWith("Plugin")) {
    return "plugin";
  }
  if (flags & ts.SymbolFlags.Class) {
    return "class";
  }
  if (flags & ts.SymbolFlags.Interface) {
    return "interface";
  }
  if (flags & ts.SymbolFlags.TypeAlias) {
    return "type";
  }
  if (
    callCount > 0 &&
    /^[A-Z][A-Za-z0-9]*$/.test(name) &&
    !name.endsWith("Error")
  ) {
    return "component";
  }
  if (callCount > 0 || flags & ts.SymbolFlags.Function) {
    return "function";
  }
  if (flags & ts.SymbolFlags.Variable) {
    return "variable";
  }
  return "type";
}

function classificationFor(
  symbol: ts.Symbol,
  exemptions: DocsExemptions,
  symbolId: string,
  summary: string
): DocsApiSymbol["classification"] {
  const exemptIds = exemptionIdSet(exemptions.symbols);
  if (exemptIds.has(symbolId) || exemptIds.has(symbol.getName())) {
    return "exempt";
  }
  if (hasTag(symbol, "internal") || hasTag(symbol, "docsHidden")) {
    return "exempt";
  }
  if (hasTag(symbol, "docsCanonical") || Boolean(tagText(symbol, "docsRole"))) {
    return "documented";
  }
  if (summary.trim().length > 0) {
    return "documented";
  }
  return "public-unlisted";
}

function listTagValues(symbol: ts.Symbol, name: string): string[] {
  return symbol
    .getJsDocTags()
    .filter((item) => item.name === name)
    .map((item) => {
      const text = item.text;
      if (typeof text === "string") {
        return text.trim();
      }

      if (!Array.isArray(text)) {
        return "";
      }
      return text
        .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
        .join(" ")
        .trim();
    })
    .filter(Boolean);
}

function semanticMetadata(symbol: ts.Symbol): DocsApiSymbol["semantic"] {
  const codes = listTagValues(symbol, "docsErrorCode");
  const numbers = listTagValues(symbol, "docsErrorNumber")
    .map(Number)
    .filter((value) => Number.isInteger(value));
  const subsystem = tagText(symbol, "docsErrorSubsystem");
  const retry = tagText(symbol, "docsRetry");
  const rights = listTagValues(symbol, "docsRequiredRight");
  const forbiddenRights = listTagValues(symbol, "docsForbiddenRight");
  const scope = tagText(symbol, "docsScope");
  const capabilities = listTagValues(symbol, "docsCapability");
  const metadata: NonNullable<DocsApiSymbol["semantic"]> = {};
  if (
    codes.length > 0 &&
    numbers.length > 0 &&
    subsystem &&
    ["never", "safe", "reconcile_first", "customer_action_required"].includes(retry)
  ) {
    metadata.error = {
      codes,
      errorNumbers: numbers,
      subsystem,
      retry: retry as DocsRetryDisposition,
    };
  }
  if (rights.length > 0 || forbiddenRights.length > 0 || scope) {
    metadata.authorization = {
      requiredRights: rights,
      forbiddenRights,
      ...(scope ? { scope } : {}),
    };
  }
  if (capabilities.length > 0) metadata.capabilities = capabilities;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function shouldWalkMembers(checker: ts.TypeChecker, type: ts.Type): boolean {
  const props = checker.getPropertiesOfType(type);
  if (props.length === 0 || props.length > 400) {
    return false;
  }
  let callable = 0;
  for (const prop of props) {
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!decl) {
      continue;
    }
    const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
    if (propType.getCallSignatures().length > 0) {
      callable += 1;
    }
  }
  return callable > 0;
}

function walkMembers(options: {
  checker: ts.TypeChecker;
  packageRoot: string;
  importPath: string;
  type: ts.Type;
  prefix: string;
  depth: number;
  seen: Set<string>;
  results: DocsApiSymbol[];
  exemptions: DocsExemptions;
  runtime: ResolvedExport["runtime"];
}): void {
  const { checker, packageRoot, importPath, type, prefix, depth, seen, results, exemptions } =
    options;
  if (depth > MAX_MEMBER_DEPTH || results.length >= MAX_MEMBERS_PER_ENTRY) {
    return;
  }
  for (const prop of checker.getPropertiesOfType(type)) {
    if (results.length >= MAX_MEMBERS_PER_ENTRY) {
      return;
    }
    const name = prop.getName();
    if (SKIP_MEMBER_NAMES.has(name) || name.startsWith("_")) {
      continue;
    }
    const decl = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!isLocalDeclaration(packageRoot, decl)) {
      continue;
    }
    const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
    const pathName = `${prefix}.${name}`;
    const callSignatures = propType.getCallSignatures();
    if (callSignatures.length > 0) {
      const id = `${importPath}#${pathName}`;
      if (!seen.has(id)) {
        seen.add(id);
        const overlay = {};
        results.push(
          buildSymbol({
            checker,
            exemptions,
            id,
            kind: "member",
            name: pathName,
            overlay,
            signature: checker.typeToString(
              propType,
              decl,
              ts.TypeFormatFlags.NoTruncation
            ),
            source: relativeSource(packageRoot, decl),
            symbol: prop,
            runtime: options.runtime,
          })
        );
      }
    }
    if (shouldWalkMembers(checker, propType)) {
      walkMembers({
        ...options,
        depth: depth + 1,
        prefix: pathName,
        type: propType,
      });
    }
  }
}

function buildSymbol(options: {
  checker: ts.TypeChecker;
  exemptions: DocsExemptions;
  id: string;
  kind: string;
  name: string;
  overlay: OverlayMap[string] | undefined;
  signature: string;
  source: string | null;
  symbol: ts.Symbol;
  runtime?: ResolvedExport["runtime"];
}): DocsApiSymbol {
  const { checker, exemptions, id, kind, name, overlay, signature, source, symbol, runtime } =
    options;
  const deprecatedText = tagText(symbol, "deprecated");
  const runtimeTag = tagText(symbol, "docsRuntime");
  const summary = overlay?.summary || documentation(checker, symbol);
  const semantic = semanticMetadata(symbol);
  return {
    id,
    name,
    kind: overlay?.category || kind,
    classification: classificationFor(symbol, exemptions, id, summary),
    signature: sanitizeSignature(signature),
    summary,
    deprecated: Boolean(deprecatedText) || hasTag(symbol, "deprecated"),
    ...(deprecatedText ? { replacement: deprecatedText } : {}),
    source,
    examples: [],
    related: listTagValues(symbol, "docsRelated").concat(
      listTagValues(symbol, "see")
    ),
    requires: listTagValues(symbol, "docsRequires"),
    forbids: listTagValues(symbol, "docsForbids"),
    tags: {
      ...(hasTag(symbol, "docsCanonical") ? { canonical: true } : {}),
      ...(tagText(symbol, "since") ? { since: tagText(symbol, "since") } : {}),
      ...(tagText(symbol, "docsRole") ? { role: tagText(symbol, "docsRole") } : {}),
      ...(tagText(symbol, "docsCategory")
        ? { category: tagText(symbol, "docsCategory") }
        : overlay?.category
          ? { category: overlay.category }
          : {}),
      ...(runtimeTag ? { runtime: runtimeTag.split(/\s+/) } : {}),
    },
    ...(semantic ? { semantic } : {}),
    ...(runtime ? { runtime } : {}),
  };
}

function createProgram(packageRoot: string, rootNames: string[]): ts.Program {
  const tsconfigPath = join(packageRoot, "tsconfig.src.json");
  if (existsSync(tsconfigPath)) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config ?? {},
      ts.sys,
      packageRoot
    );
    return ts.createProgram({
      options: {
        ...parsed.options,
        skipLibCheck: true,
      },
      rootNames: rootNames.length > 0 ? rootNames : parsed.fileNames,
    });
  }
  return ts.createProgram(rootNames, {
    allowJs: false,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    types: ["node"],
  });
}

function collectExamples(
  examplesRoot: string,
  repoRelativePrefix: string
): DocsApiExample[] {
  if (!existsSync(examplesRoot)) {
    return [];
  }
  const out: DocsApiExample[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(entry.name)) {
        continue;
      }
      const text = readFileSync(full, "utf8");
      const apiMatch = text.match(/\/\/\s*@docs-api\s+(\S+)/);
      if (!apiMatch) {
        continue;
      }
      const entrypoint = text.match(/\/\/\s*@docs-entrypoint\s+(\S+)/)?.[1];
      const pathTag = text.match(/\/\/\s*@docs-path\s+(\S+)/)?.[1];
      const title = text.match(/^(?:\/\/|#)\s*@title\s+(.+)$/m)?.[1]?.trim();
      const rel = relative(examplesRoot, full).replace(/\\/g, "/");
      const id = rel.replace(/\.(tsx?|jsx?)$/, "").replaceAll("/", ".");
      const symbolName = apiMatch[1];
      const symbolIds = entrypoint
        ? [`${entrypoint}#${symbolName}`]
        : [symbolName];
      out.push({
        id,
        file: `${repoRelativePrefix}/${rel}`,
        symbolIds,
        ...(entrypoint ? { entrypoint } : {}),
        ...(pathTag ? { path: pathTag } : {}),
        ...(title ? { title } : {}),
      });
    }
  }
  walk(examplesRoot);
  return out;
}

function attachExamples(ir: DocsApiIr): void {
  const byId = new Map<string, DocsApiSymbol>();
  for (const entry of ir.entrypoints) {
    for (const symbol of entry.symbols) {
      byId.set(symbol.id, symbol);
      byId.set(symbol.name, symbol);
    }
  }
  for (const example of ir.examples) {
    for (const symbolId of example.symbolIds) {
      const direct = byId.get(symbolId);
      if (direct) {
        direct.examples.push(example.id);
        continue;
      }
      const hash = symbolId.includes("#") ? symbolId.slice(symbolId.indexOf("#") + 1) : symbolId;
      const fallback = byId.get(hash);
      if (fallback && !fallback.examples.includes(example.id)) {
        fallback.examples.push(example.id);
      }
    }
  }
}

export function extractDocsApi(packageRoot: string): DocsApiIr {
  const pkg = readPackageJson(packageRoot);
  const exemptions = loadJson<DocsExemptions>(
    join(packageRoot, "docs", "api.exemptions.json"),
    {}
  );
  const overlay = loadOverlay(packageRoot);
  const resolved = resolvePublishedExports({
    packageRoot,
    packageName: pkg.name,
    exports: pkg.exports,
  });
  const sourceFiles = [
    ...new Set(
      resolved
        .map((item) => item.source)
        .filter((item): item is string => Boolean(item && item.startsWith("src/")))
        .map((item) => join(packageRoot, item))
    ),
  ];
  const program = createProgram(packageRoot, sourceFiles);
  const checker = program.getTypeChecker();
  const exemptExportKeys = exemptionIdSet(exemptions.exportKeys);
  const walkMembersEnabled = pkg.name === "@xylex-group/athena";

  const entrypoints: DocsApiEntrypoint[] = [];
  for (const entry of resolved) {
    if (exemptExportKeys.has(entry.exportKey) || entry.kind === "css") {
      entrypoints.push({
        importPath: entry.importPath,
        exportKey: entry.exportKey,
        runtime: entry.runtime,
        runtimeClassification: entry.runtimeClassification,
        framework: entry.framework,
        source: entry.source,
        kind: entry.kind === "css" ? "css" : "skipped",
        symbols: [],
      });
      continue;
    }
    if (!entry.source) {
      entrypoints.push({
        importPath: entry.importPath,
        exportKey: entry.exportKey,
        runtime: entry.runtime,
        runtimeClassification: entry.runtimeClassification,
        framework: entry.framework,
        source: null,
        kind: "skipped",
        symbols: [],
      });
      continue;
    }
    const abs = join(packageRoot, entry.source);
    const sourceFile = program.getSourceFile(abs);
    if (!sourceFile) {
      entrypoints.push({
        importPath: entry.importPath,
        exportKey: entry.exportKey,
        runtime: entry.runtime,
        runtimeClassification: entry.runtimeClassification,
        framework: entry.framework,
        source: entry.source,
        kind: "skipped",
        symbols: [],
      });
      continue;
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      continue;
    }
    const sidecar = loadSidecarDocs(packageRoot, entry.source);
    const seen = new Set<string>();
    const symbols: DocsApiSymbol[] = [];
    for (const exportedRaw of checker.getExportsOfModule(moduleSymbol)) {
      let exported = exportedRaw;
      if (exportedRaw.getFlags() & ts.SymbolFlags.Alias) {
        try {
          exported = checker.getAliasedSymbol(exportedRaw);
        } catch {
          exported = exportedRaw;
        }
      }
      const name = exportedRaw.getName();
      const id = `${entry.importPath}#${name}`;
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const decl = exported.valueDeclaration ?? exported.declarations?.[0];
      const type = decl
        ? checker.getTypeOfSymbolAtLocation(exported, decl)
        : checker.getDeclaredTypeOfSymbol(exported);
      const callCount = type.getCallSignatures().length;
      const mergedOverlay = overlay[name] ?? sidecar[name];
      symbols.push(
        buildSymbol({
          checker,
          exemptions,
          id,
          kind: classifyKind(name, exported.getFlags(), callCount, mergedOverlay?.category),
          name,
          overlay: mergedOverlay,
          signature: checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation),
          source: relativeSource(packageRoot, decl) || entry.source,
          symbol: exported,
          runtime: entry.runtime,
        })
      );
      if (!walkMembersEnabled || !decl) {
        continue;
      }
      const walkThis =
        name === "createClient" ||
        tagText(exported, "docsRole") === "root-client-constructor" ||
        (exported.getFlags() & ts.SymbolFlags.Interface &&
          /(Client|Module|Bindings|QueryBuilder|Chain)$/.test(name));
      if (!walkThis) {
        continue;
      }
      let walkType = type;
      if (callCount > 0) {
        walkType = type.getCallSignatures()[0]?.getReturnType() ?? type;
      }
      if (shouldWalkMembers(checker, walkType)) {
        const prefix =
          name === "createClient" || tagText(exported, "docsRole") === "root-client-constructor"
            ? "athena"
            : name;
        walkMembers({
          checker,
          exemptions,
          importPath: entry.importPath,
          packageRoot,
          prefix,
          results: symbols,
          seen,
          depth: 0,
          type: walkType,
          runtime: entry.runtime,
        });
      }
    }
    entrypoints.push({
      importPath: entry.importPath,
      exportKey: entry.exportKey,
      runtime: entry.runtime,
      runtimeClassification: entry.runtimeClassification,
      framework: entry.framework,
      source: entry.source,
      kind: "module",
      symbols,
    });
  }

  const examplesRoot = join(
    packageRoot,
    "..",
    "..",
    "apps",
    "docs-athena-js",
    "examples"
  );
  const examples = collectExamples(examplesRoot, "apps/docs-athena-js/examples").filter(
    (example) =>
      !example.entrypoint || example.entrypoint.startsWith(pkg.name)
  );
  const ir: DocsApiIr = {
    schema: "athena/docs-api/v2",
    package: { name: pkg.name, version: pkg.version },
    source: {
      packageJsonDigest: packageJsonDigest({
        name: pkg.name,
        version: pkg.version,
        exports: pkg.exports,
      }),
    },
    entrypoints,
    examples,
    errors: loadErrorRegistry(packageRoot),
  };
  attachExamples(ir);
  return ir;
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
