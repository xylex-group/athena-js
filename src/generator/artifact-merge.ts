import type {
  GeneratedArtifact,
  GeneratorArtifactKind,
  GeneratorArtifactWritePolicy,
  SkippedGeneratedArtifactReason,
  WrittenGeneratedArtifactReason,
} from "./types.ts";

export interface ArtifactMergeResult {
  action: "write" | "unchanged" | "skip";
  added: string[];
  conflicts: string[];
  content?: string;
  detail?: string;
  lintErrors: string[];
  preservedCustom: string[];
  skipReason?: SkippedGeneratedArtifactReason;
  writeReason?: WrittenGeneratedArtifactReason;
}

interface StyleFingerprint {
  indent: string;
  newline: "\n" | "\r\n";
  quote: "'" | '"';
  semicolons: boolean;
  trailingComma: boolean;
}

interface NamedImport {
  end: number;
  module: string;
  names: string[];
  raw: string;
  start: number;
}

interface ObjectEntry {
  key: string;
  raw: string;
  value: string;
}

interface DefineBlock {
  bodyEnd: number;
  bodyStart: number;
  callName: string;
  entries: ObjectEntry[];
  exportName: string;
  fullEnd: number;
  fullStart: number;
  kind: "database" | "registry";
  raw: string;
}

interface MetaBlock {
  bodyEnd: number;
  bodyStart: number;
  entries: ObjectEntry[];
  fullEnd: number;
  fullStart: number;
  raw: string;
}

const IMPORT_RE =
  /^import\s+(?:type\s+)?(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s+from\s+(['"])([^'"]+)\3\s*;?\s*$/gm;

const DEFINE_EXPORT_RE =
  /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(define(?:Database|Registry))\s*\(\s*\{/g;

const META_EXPORT_RE = /export\s+const\s+__athena_schema_meta\s*=\s*\{/g;

const KNOWN_META_KEYS = new Set([
  "schemaVersion",
  "generatedAt",
  "database",
  "outputPreset",
  "outputFormat",
]);

function detectNewline(source: string): "\n" | "\r\n" {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function detectStyle(source: string): StyleFingerprint {
  const newline = detectNewline(source);
  const single = (source.match(/'/g) ?? []).length;
  const double = (source.match(/"/g) ?? []).length;
  const quote: "'" | '"' = double > single ? '"' : "'";

  const importLines = source
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith("import "));
  const semicolons =
    importLines.length > 0
      ? importLines.filter((line) => line.trimEnd().endsWith(";")).length >=
        importLines.length / 2
      : false;

  const objectLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_'"]+\s*:\s*.+/.test(line));
  const trailingComma =
    objectLines.length > 0
      ? objectLines.filter((line) => line.endsWith(",")).length >=
        Math.ceil(objectLines.length / 2)
      : true;

  const indentMatch = source.match(/\n([ \t]+)\S/);
  const indent = indentMatch?.[1] ?? "  ";

  return { indent, newline, quote, semicolons, trailingComma };
}

function quoteString(value: string, quote: "'" | '"'): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote, "g"), `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

function parseNamedImports(source: string): NamedImport[] {
  const imports: NamedImport[] = [];
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null = IMPORT_RE.exec(source);
  while (match !== null) {
    const named = match[1];
    const defaultName = match[2];
    const module = match[4];
    const names = named
      ? named
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const alias = part.split(/\s+as\s+/);
            return (alias[1] ?? alias[0]).trim();
          })
      : defaultName
        ? [defaultName]
        : [];

    imports.push({
      end: match.index + match[0].length,
      module,
      names,
      raw: match[0],
      start: match.index,
    });
    match = IMPORT_RE.exec(source);
  }
  return imports;
}

function findMatchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && (inSingle || inDouble || inTemplate)) {
      escaped = true;
      continue;
    }
    if (!(inDouble || inTemplate) && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!(inSingle || inTemplate) && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!(inSingle || inDouble) && ch === "`") {
      inTemplate = !inTemplate;
      continue;
    }
    if (inSingle || inDouble || inTemplate) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function parseObjectEntries(body: string): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      continue;
    }
    const withoutComma = trimmed.endsWith(",")
      ? trimmed.slice(0, -1).trimEnd()
      : trimmed;
    const match = withoutComma.match(
      /^([A-Za-z_$][\w$]*|['"][^'"]+['"])\s*:\s*(.+)$/
    );
    if (!match) {
      continue;
    }
    const keyRaw = match[1];
    const key =
      keyRaw.startsWith("'") || keyRaw.startsWith('"')
        ? keyRaw.slice(1, -1)
        : keyRaw;
    entries.push({
      key,
      raw: trimmed,
      value: match[2].trim(),
    });
  }
  return entries;
}

function parseDefineBlocks(source: string): DefineBlock[] {
  const blocks: DefineBlock[] = [];
  DEFINE_EXPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null = DEFINE_EXPORT_RE.exec(source);
  while (match !== null) {
    const exportName = match[1];
    const callName = match[2];
    const openBrace = match.index + match[0].lastIndexOf("{");
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace >= 0) {
      const body = source.slice(openBrace + 1, closeBrace);
      const fullEnd = (() => {
        let i = closeBrace + 1;
        while (i < source.length && /\s/.test(source[i])) {
          i += 1;
        }
        if (source[i] === ")") {
          i += 1;
        }
        while (i < source.length && /\s/.test(source[i])) {
          i += 1;
        }
        if (source[i] === ";") {
          i += 1;
        }
        return i;
      })();
      blocks.push({
        bodyEnd: closeBrace,
        bodyStart: openBrace + 1,
        callName,
        entries: parseObjectEntries(body),
        exportName,
        fullEnd,
        fullStart: match.index,
        kind: callName === "defineDatabase" ? "database" : "registry",
        raw: source.slice(match.index, fullEnd),
      });
    }
    match = DEFINE_EXPORT_RE.exec(source);
  }
  return blocks;
}

function parseMetaBlock(source: string): MetaBlock | undefined {
  META_EXPORT_RE.lastIndex = 0;
  const match = META_EXPORT_RE.exec(source);
  if (!match) {
    return;
  }
  const openBrace = match.index + match[0].lastIndexOf("{");
  const closeBrace = findMatchingBrace(source, openBrace);
  if (closeBrace < 0) {
    return;
  }
  let fullEnd = closeBrace + 1;
  const after = source.slice(fullEnd);
  const asConst = after.match(/^\s*as\s+const\s*;?/);
  if (asConst) {
    fullEnd += asConst[0].length;
  } else if (source[fullEnd] === ";") {
    fullEnd += 1;
  }
  return {
    bodyEnd: closeBrace,
    bodyStart: openBrace + 1,
    entries: parseObjectEntries(source.slice(openBrace + 1, closeBrace)),
    fullEnd,
    fullStart: match.index,
    raw: source.slice(match.index, fullEnd),
  };
}

function hasImportBinding(
  imports: NamedImport[],
  name: string,
  module?: string
): boolean {
  return imports.some(
    (item) =>
      item.names.includes(name) &&
      (module === undefined ||
        normalizeModulePath(item.module) === normalizeModulePath(module))
  );
}

function findImportForName(
  imports: NamedImport[],
  name: string
): NamedImport | undefined {
  return imports.find((item) => item.names.includes(name));
}

function normalizeModulePath(modulePath: string): string {
  return modulePath
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\.ts$/, "");
}

function formatImport(
  names: string[],
  modulePath: string,
  style: StyleFingerprint
): string {
  const body = `import { ${names.join(", ")} } from ${quoteString(modulePath, style.quote)}`;
  return style.semicolons ? `${body};` : body;
}

function formatObjectEntry(
  key: string,
  value: string,
  style: StyleFingerprint,
  isLast: boolean
): string {
  const needsQuote = !/^[A-Za-z_$][\w$]*$/.test(key);
  const renderedKey = needsQuote ? quoteString(key, style.quote) : key;
  const comma = !isLast || style.trailingComma ? "," : "";
  return `${style.indent}${renderedKey}: ${value}${comma}`;
}

function replaceRange(
  source: string,
  start: number,
  end: number,
  insertion: string
): string {
  return source.slice(0, start) + insertion + source.slice(end);
}

function collectDuplicateKeys(entries: ObjectEntry[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      dupes.push(entry.key);
    }
    seen.add(entry.key);
  }
  return dupes;
}

function collectDuplicateImportBindings(imports: NamedImport[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const item of imports) {
    for (const name of item.names) {
      if (seen.has(name)) {
        dupes.push(name);
      }
      seen.add(name);
    }
  }
  return dupes;
}

function lintArtifactSource(
  source: string,
  kind: "database" | "registry"
): string[] {
  const errors: string[] = [];
  const imports = parseNamedImports(source);
  const dupImports = collectDuplicateImportBindings(imports);
  if (dupImports.length > 0) {
    errors.push(`duplicate import bindings: ${dupImports.join(", ")}`);
  }

  const blocks = parseDefineBlocks(source).filter(
    (block) => block.kind === kind
  );
  if (blocks.length === 0) {
    errors.push(
      `missing export const … = define${kind === "database" ? "Database" : "Registry"}({…})`
    );
    return errors;
  }
  if (blocks.length > 1) {
    errors.push(
      `multiple define${kind === "database" ? "Database" : "Registry"} exports found`
    );
  }

  const block = blocks[0];
  const dupKeys = collectDuplicateKeys(block.entries);
  if (dupKeys.length > 0) {
    errors.push(`duplicate object keys: ${dupKeys.join(", ")}`);
  }

  for (const entry of block.entries) {
    const valueId = entry.value.match(/^[A-Za-z_$][\w$]*$/)?.[0];
    // value should be imported (schema const / database const)
    if (
      valueId &&
      !hasImportBinding(imports, valueId) &&
      valueId !== block.exportName &&
      !(
        source.includes(`const ${valueId}`) ||
        source.includes(`function ${valueId}`)
      )
    ) {
      errors.push(`value "${valueId}" for key "${entry.key}" is not imported`);
    }
  }

  if (kind === "database" && !hasImportBinding(imports, "defineDatabase")) {
    errors.push("missing defineDatabase import");
  }
  if (kind === "registry" && !hasImportBinding(imports, "defineRegistry")) {
    errors.push("missing defineRegistry import");
  }

  return errors;
}

function preservedCustomUnits(
  existing: string,
  generated: string,
  kind: "database" | "registry"
): string[] {
  const custom: string[] = [];
  const existingImports = parseNamedImports(existing);
  const generatedImports = parseNamedImports(generated);
  const generatedModules = new Set(
    generatedImports.map((item) => normalizeModulePath(item.module))
  );
  const generatedNames = new Set(
    generatedImports.flatMap((item) => item.names)
  );

  for (const item of existingImports) {
    const moduleNorm = normalizeModulePath(item.module);
    if (moduleNorm.includes("@xylex-group/athena")) {
      continue;
    }
    const unexpectedNames = item.names.filter(
      (name) => !generatedNames.has(name)
    );
    if (unexpectedNames.length > 0 && !generatedModules.has(moduleNorm)) {
      custom.push(
        `import { ${unexpectedNames.join(", ")} } from '${item.module}'`
      );
    } else if (unexpectedNames.length > 0) {
      custom.push(`import binding(s): ${unexpectedNames.join(", ")}`);
    }
  }

  const existingBlocks = parseDefineBlocks(existing).filter(
    (block) => block.kind === kind
  );
  const generatedBlocks = parseDefineBlocks(generated).filter(
    (block) => block.kind === kind
  );
  const generatedKeys = new Set(
    generatedBlocks[0]?.entries.map((entry) => entry.key) ?? []
  );
  for (const entry of existingBlocks[0]?.entries ?? []) {
    if (!generatedKeys.has(entry.key)) {
      custom.push(`${kind} entry: ${entry.key}: ${entry.value}`);
    }
  }

  if (kind === "registry") {
    const existingMeta = parseMetaBlock(existing);
    const generatedMeta = parseMetaBlock(generated);
    const generatedMetaKeys = new Set(
      generatedMeta?.entries.map((entry) => entry.key) ?? []
    );
    for (const entry of existingMeta?.entries ?? []) {
      if (
        !(generatedMetaKeys.has(entry.key) || KNOWN_META_KEYS.has(entry.key))
      ) {
        custom.push(`meta entry: ${entry.key}: ${entry.value}`);
      }
    }
  }

  // Extra top-level export const lines not in generated output
  const exportConstRe = /^export\s+const\s+([A-Za-z_$][\w$]*)\b/gm;
  const generatedExports = new Set<string>();
  let match: RegExpExecArray | null;
  exportConstRe.lastIndex = 0;
  match = exportConstRe.exec(generated);
  while (match !== null) {
    generatedExports.add(match[1]);
    match = exportConstRe.exec(generated);
  }
  exportConstRe.lastIndex = 0;
  match = exportConstRe.exec(existing);
  while (match !== null) {
    if (
      !generatedExports.has(match[1]) &&
      match[1] !== "__athena_schema_meta"
    ) {
      custom.push(`export const ${match[1]}`);
    }
    match = exportConstRe.exec(existing);
  }

  return custom;
}

function insertImportAfterPackageImports(
  source: string,
  importLine: string,
  style: StyleFingerprint
): string {
  const imports = parseNamedImports(source);
  if (imports.length === 0) {
    return `${importLine}${style.newline}${source}`;
  }

  // Prefer inserting after the last local/relative import; if none, after last import.
  let anchor = imports.at(-1);
  for (let i = imports.length - 1; i >= 0; i -= 1) {
    if (imports[i].module.startsWith(".")) {
      anchor = imports[i];
      break;
    }
  }

  if (!anchor) {
    return `${importLine}${style.newline}${source}`;
  }

  const insertAt = anchor.end;
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  const needsLeadingNl = !before.endsWith("\n");
  const prefix = needsLeadingNl ? style.newline : "";
  return `${before}${prefix}${importLine}${after.startsWith("\n") || after.startsWith("\r\n") ? "" : style.newline}${after}`;
}

function rewriteObjectBody(
  entries: ObjectEntry[],
  style: StyleFingerprint
): string {
  if (entries.length === 0) {
    return style.newline;
  }
  const lines = entries.map((entry, index) =>
    formatObjectEntry(
      entry.key,
      entry.value,
      style,
      index === entries.length - 1
    )
  );
  return `${style.newline}${lines.join(style.newline)}${style.newline}`;
}

function mergeDatabaseArtifact(
  existing: string,
  generated: string
): ArtifactMergeResult {
  const style = detectStyle(existing);
  const generatedStyle = detectStyle(generated);
  const effectiveStyle: StyleFingerprint = {
    ...style,
    // Prefer existing fingerprint; fall back to generated if existing is empty-ish
    quote:
      existing.includes('"') || existing.includes("'")
        ? style.quote
        : generatedStyle.quote,
  };

  const generatedImports = parseNamedImports(generated);
  const existingBlocks = parseDefineBlocks(existing).filter(
    (block) => block.kind === "database"
  );
  const generatedBlocks = parseDefineBlocks(generated).filter(
    (block) => block.kind === "database"
  );

  if (existingBlocks.length === 0 || generatedBlocks.length === 0) {
    return {
      action: "skip",
      added: [],
      conflicts: [],
      detail: "could not locate defineDatabase({…}) export for merge",
      lintErrors: [],
      preservedCustom: [],
      skipReason: "merge-unparseable",
    };
  }

  const generatedBlock = generatedBlocks[0];
  const conflicts: string[] = [];
  const added: string[] = [];
  let next = existing;

  // Ensure defineDatabase import
  if (!hasImportBinding(parseNamedImports(next), "defineDatabase")) {
    const pkgImport = generatedImports.find((item) =>
      item.names.includes("defineDatabase")
    );
    if (pkgImport) {
      const line = formatImport(
        ["defineDatabase"],
        pkgImport.module,
        effectiveStyle
      );
      next = insertImportAfterPackageImports(next, line, effectiveStyle);
      added.push("import defineDatabase");
    }
  }

  // Re-parse after possible import insert
  let workingImports = parseNamedImports(next);
  let workingBlocks = parseDefineBlocks(next).filter(
    (block) => block.kind === "database"
  );
  let workingBlock = workingBlocks[0];
  const entryMap = new Map(
    workingBlock.entries.map((entry) => [entry.key, entry])
  );

  for (const desired of generatedBlock.entries) {
    const existingEntry = entryMap.get(desired.key);
    if (existingEntry) {
      if (existingEntry.value !== desired.value) {
        conflicts.push(
          `key "${desired.key}" maps to ${existingEntry.value} (existing) vs ${desired.value} (generated)`
        );
      }
      continue;
    }

    // Find generated import for the schema const
    const desiredImport = generatedImports.find((item) =>
      item.names.includes(desired.value)
    );
    if (desiredImport) {
      const existingForName = findImportForName(workingImports, desired.value);
      if (existingForName) {
        if (
          normalizeModulePath(existingForName.module) !==
          normalizeModulePath(desiredImport.module)
        ) {
          conflicts.push(
            `binding "${desired.value}" imported from '${existingForName.module}' vs '${desiredImport.module}'`
          );
          continue;
        }
      } else {
        const line = formatImport(
          [desired.value],
          desiredImport.module,
          effectiveStyle
        );
        next = insertImportAfterPackageImports(next, line, effectiveStyle);
        added.push(`import ${desired.value}`);
        workingImports = parseNamedImports(next);
      }
    }

    // Re-locate block after import edits
    workingBlocks = parseDefineBlocks(next).filter(
      (block) => block.kind === "database"
    );
    workingBlock = workingBlocks[0];
    const nextEntries = [
      ...workingBlock.entries,
      { key: desired.key, raw: "", value: desired.value },
    ];
    const body = rewriteObjectBody(nextEntries, effectiveStyle);
    next = replaceRange(
      next,
      workingBlock.bodyStart,
      workingBlock.bodyEnd,
      body
    );
    entryMap.set(desired.key, {
      key: desired.key,
      raw: "",
      value: desired.value,
    });
    added.push(`database entry: ${desired.key}`);
  }

  if (conflicts.length > 0 && added.length === 0) {
    return {
      action: "skip",
      added: [],
      conflicts,
      detail: conflicts.join("; "),
      lintErrors: [],
      preservedCustom: preservedCustomUnits(existing, generated, "database"),
      skipReason: "merge-conflict",
    };
  }

  const lintErrors = lintArtifactSource(next, "database");
  if (lintErrors.length > 0) {
    return {
      action: "skip",
      added,
      conflicts,
      detail: lintErrors.join("; "),
      lintErrors,
      preservedCustom: preservedCustomUnits(existing, generated, "database"),
      skipReason: "merge-lint-failed",
    };
  }

  const preservedCustom = preservedCustomUnits(next, generated, "database");
  if (
    next === existing ||
    next.replace(/\r\n/g, "\n") === existing.replace(/\r\n/g, "\n")
  ) {
    return {
      action: "unchanged",
      added: [],
      conflicts,
      content: existing,
      detail: conflicts.length > 0 ? conflicts.join("; ") : undefined,
      lintErrors: [],
      preservedCustom,
      skipReason: "already-current",
    };
  }

  return {
    action: "write",
    added,
    conflicts,
    content: next.endsWith("\n") ? next : `${next}${effectiveStyle.newline}`,
    lintErrors: [],
    preservedCustom,
    writeReason: "merged",
  };
}

function mergeMetaFields(
  existingMeta: MetaBlock | undefined,
  generatedMeta: MetaBlock | undefined
): { entries: ObjectEntry[]; changed: boolean; added: string[] } {
  const added: string[] = [];
  if (!generatedMeta) {
    return { added, changed: false, entries: existingMeta?.entries ?? [] };
  }
  if (!existingMeta) {
    return {
      added: generatedMeta.entries.map((entry) => `meta entry: ${entry.key}`),
      changed: true,
      entries: generatedMeta.entries,
    };
  }

  const map = new Map(existingMeta.entries.map((entry) => [entry.key, entry]));
  let changed = false;

  for (const desired of generatedMeta.entries) {
    const current = map.get(desired.key);
    if (!current) {
      map.set(desired.key, desired);
      added.push(`meta entry: ${desired.key}`);
      changed = true;
      continue;
    }
    // Refresh known meta fields when they differ (except generatedAt — only if other meta missing was handled).
    // Always refresh generatedAt / schemaVersion / output fields when values differ so registry stays truthful.
    if (KNOWN_META_KEYS.has(desired.key) && current.value !== desired.value) {
      map.set(desired.key, desired);
      added.push(`meta refresh: ${desired.key}`);
      changed = true;
    }
  }

  // Preserve order: existing keys first, then newly added known keys in generated order
  const ordered: ObjectEntry[] = [];
  const seen = new Set<string>();
  for (const entry of existingMeta.entries) {
    const next = map.get(entry.key);
    if (next) {
      ordered.push(next);
      seen.add(entry.key);
    }
  }
  for (const entry of generatedMeta.entries) {
    if (!seen.has(entry.key)) {
      const next = map.get(entry.key);
      if (next) {
        ordered.push(next);
        seen.add(entry.key);
      }
    }
  }
  for (const [key, entry] of map) {
    if (!seen.has(key)) {
      ordered.push(entry);
    }
  }

  return { added, changed, entries: ordered };
}

function mergeRegistryArtifact(
  existing: string,
  generated: string
): ArtifactMergeResult {
  const style = detectStyle(existing);
  const effectiveStyle = style;
  const generatedImports = parseNamedImports(generated);
  const existingBlocks = parseDefineBlocks(existing).filter(
    (block) => block.kind === "registry"
  );
  const generatedBlocks = parseDefineBlocks(generated).filter(
    (block) => block.kind === "registry"
  );

  if (existingBlocks.length === 0 || generatedBlocks.length === 0) {
    return {
      action: "skip",
      added: [],
      conflicts: [],
      detail: "could not locate defineRegistry({…}) export for merge",
      lintErrors: [],
      preservedCustom: [],
      skipReason: "merge-unparseable",
    };
  }

  const existingBlock = existingBlocks[0];
  const generatedBlock = generatedBlocks[0];
  const conflicts: string[] = [];
  const added: string[] = [];
  let next = existing;

  if (!hasImportBinding(parseNamedImports(next), "defineRegistry")) {
    const pkgImport = generatedImports.find((item) =>
      item.names.includes("defineRegistry")
    );
    if (pkgImport) {
      next = insertImportAfterPackageImports(
        next,
        formatImport(["defineRegistry"], pkgImport.module, effectiveStyle),
        effectiveStyle
      );
      added.push("import defineRegistry");
    }
  }

  // Database const import from generated (prefer existing const name if entry already present)
  const preferredDbValue =
    existingBlock.entries[0]?.value ?? generatedBlock.entries[0]?.value;
  const generatedDbImport =
    generatedImports.find((item) =>
      item.names.includes(generatedBlock.entries[0]?.value ?? "")
    ) ?? generatedImports.find((item) => item.module.startsWith("."));

  if (preferredDbValue && generatedDbImport) {
    const existingForName = findImportForName(
      parseNamedImports(next),
      preferredDbValue
    );
    if (!existingForName) {
      const modulePath = generatedDbImport.module;
      const importName =
        findImportForName(generatedImports, preferredDbValue)?.names[0] ??
        generatedBlock.entries[0]?.value ??
        preferredDbValue;
      if (!hasImportBinding(parseNamedImports(next), importName)) {
        next = insertImportAfterPackageImports(
          next,
          formatImport([importName], modulePath, effectiveStyle),
          effectiveStyle
        );
        added.push(`import ${importName}`);
      }
    } else if (
      normalizeModulePath(existingForName.module) !==
      normalizeModulePath(generatedDbImport.module)
    ) {
      conflicts.push(
        `binding "${preferredDbValue}" imported from '${existingForName.module}' vs '${generatedDbImport.module}'`
      );
    }
  }

  // Merge defineRegistry entries (additive)
  let workingBlocks = parseDefineBlocks(next).filter(
    (block) => block.kind === "registry"
  );
  let workingBlock = workingBlocks[0];
  const entryMap = new Map(
    workingBlock.entries.map((entry) => [entry.key, entry])
  );

  for (const desired of generatedBlock.entries) {
    // Prefer existing value name for same key if present
    const existingEntry = entryMap.get(desired.key);
    if (existingEntry) {
      // Keep existing value (const name); only conflict if we cannot reconcile
      continue;
    }

    // Use desired key with existing imported database const if any
    const dbImport = parseNamedImports(next).find(
      (item) =>
        item.module.startsWith(".") &&
        item.names.some((name) => name !== "defineRegistry")
    );
    const value = dbImport?.names[0] ?? desired.value;
    const nextEntries = [
      ...workingBlock.entries,
      { key: desired.key, raw: "", value },
    ];
    const body = rewriteObjectBody(nextEntries, effectiveStyle);
    next = replaceRange(
      next,
      workingBlock.bodyStart,
      workingBlock.bodyEnd,
      body
    );
    entryMap.set(desired.key, { key: desired.key, raw: "", value });
    added.push(`registry entry: ${desired.key}`);
    workingBlocks = parseDefineBlocks(next).filter(
      (block) => block.kind === "registry"
    );
    workingBlock = workingBlocks[0];
  }

  // Meta merge — only refresh meta when structural adds happened OR known fields are missing.
  // To avoid dirty git on pure no-ops: if nothing else changed, only fill missing meta keys
  // (do not bump generatedAt alone).
  const existingMeta = parseMetaBlock(next);
  const generatedMeta = parseMetaBlock(generated);
  const structuralAdded = added.length > 0;

  if (generatedMeta) {
    if (existingMeta) {
      const desiredEntries = structuralAdded
        ? generatedMeta.entries
        : generatedMeta.entries.filter((entry) => {
            // Only add missing keys; do not refresh generatedAt when nothing else changed
            return !existingMeta.entries.some(
              (current) => current.key === entry.key
            );
          });

      if (structuralAdded) {
        const merged = mergeMetaFields(existingMeta, generatedMeta);
        if (merged.changed) {
          // re-parse meta on next
          const metaNow = parseMetaBlock(next);
          if (metaNow) {
            const body = rewriteObjectBody(merged.entries, effectiveStyle);
            next = replaceRange(next, metaNow.bodyStart, metaNow.bodyEnd, body);
            added.push(...merged.added);
          }
        }
      } else if (desiredEntries.length > 0) {
        const map = new Map(
          existingMeta.entries.map((entry) => [entry.key, entry])
        );
        for (const entry of desiredEntries) {
          map.set(entry.key, entry);
          added.push(`meta entry: ${entry.key}`);
        }
        const ordered = [
          ...existingMeta.entries.map((entry) => map.get(entry.key)!),
          ...desiredEntries.filter(
            (entry) => !existingMeta.entries.some((e) => e.key === entry.key)
          ),
        ];
        const metaNow = parseMetaBlock(next);
        if (metaNow) {
          const body = rewriteObjectBody(ordered, effectiveStyle);
          next = replaceRange(next, metaNow.bodyStart, metaNow.bodyEnd, body);
        }
      }
    } else {
      // Insert meta before defineRegistry export
      const blocks = parseDefineBlocks(next).filter(
        (block) => block.kind === "registry"
      );
      const insertAt = blocks[0]?.fullStart ?? next.length;
      const metaBody = rewriteObjectBody(generatedMeta.entries, effectiveStyle);
      const metaBlock = `export const __athena_schema_meta = {${metaBody}} as const${effectiveStyle.semicolons ? ";" : ""}${effectiveStyle.newline}${effectiveStyle.newline}`;
      next = replaceRange(next, insertAt, insertAt, metaBlock);
      added.push("__athena_schema_meta");
    }
  }

  if (conflicts.length > 0 && added.length === 0) {
    return {
      action: "skip",
      added: [],
      conflicts,
      detail: conflicts.join("; "),
      lintErrors: [],
      preservedCustom: preservedCustomUnits(existing, generated, "registry"),
      skipReason: "merge-conflict",
    };
  }

  const lintErrors = lintArtifactSource(next, "registry");
  if (lintErrors.length > 0) {
    return {
      action: "skip",
      added,
      conflicts,
      detail: lintErrors.join("; "),
      lintErrors,
      preservedCustom: preservedCustomUnits(existing, generated, "registry"),
      skipReason: "merge-lint-failed",
    };
  }

  const preservedCustom = preservedCustomUnits(next, generated, "registry");
  if (next.replace(/\r\n/g, "\n") === existing.replace(/\r\n/g, "\n")) {
    return {
      action: "unchanged",
      added: [],
      conflicts,
      content: existing,
      lintErrors: [],
      preservedCustom,
      skipReason: "already-current",
    };
  }

  return {
    action: "write",
    added,
    conflicts,
    content: next.endsWith("\n") ? next : `${next}${effectiveStyle.newline}`,
    lintErrors: [],
    preservedCustom,
    writeReason: "merged",
  };
}

/**
 * Merge generated database/registry content into an existing on-disk file.
 * Additive only: never deletes imports or object keys.
 */
export function mergeProtectedArtifact(
  kind: Extract<GeneratorArtifactKind, "database" | "registry">,
  existing: string,
  generated: string,
  policy: GeneratorArtifactWritePolicy
): ArtifactMergeResult {
  if (policy === "overwrite") {
    if (existing.replace(/\r\n/g, "\n") === generated.replace(/\r\n/g, "\n")) {
      return {
        action: "unchanged",
        added: [],
        conflicts: [],
        content: existing,
        lintErrors: [],
        preservedCustom: [],
        skipReason: "already-current",
      };
    }
    return {
      action: "write",
      added: ["full overwrite"],
      conflicts: [],
      content: generated,
      lintErrors: [],
      preservedCustom: [],
      writeReason: "overwritten",
    };
  }

  if (policy === "skip") {
    return {
      action: "skip",
      added: [],
      conflicts: [],
      detail: "artifactWrite policy is skip",
      lintErrors: [],
      preservedCustom: preservedCustomUnits(existing, generated, kind),
      skipReason: "protected-existing-file",
    };
  }

  return kind === "database"
    ? mergeDatabaseArtifact(existing, generated)
    : mergeRegistryArtifact(existing, generated);
}

/**
 * Plan write action for any generated artifact (used by pipeline).
 */
export function resolveArtifactWritePlan(
  file: GeneratedArtifact,
  existingContent: string | null,
  policy: GeneratorArtifactWritePolicy | "always"
): ArtifactMergeResult {
  if (existingContent === null) {
    return {
      action: "write",
      added: ["created"],
      conflicts: [],
      content: file.content,
      lintErrors: [],
      preservedCustom: [],
      writeReason: "created",
    };
  }

  if (file.kind === "model" || file.kind === "schema" || policy === "always") {
    if (
      existingContent.replace(/\r\n/g, "\n") ===
      file.content.replace(/\r\n/g, "\n")
    ) {
      return {
        action: "unchanged",
        added: [],
        conflicts: [],
        content: existingContent,
        lintErrors: [],
        preservedCustom: [],
        skipReason: "already-current",
      };
    }
    return {
      action: "write",
      added: ["overwritten"],
      conflicts: [],
      content: file.content,
      lintErrors: [],
      preservedCustom: [],
      writeReason: existingContent ? "overwritten" : "created",
    };
  }

  return mergeProtectedArtifact(
    file.kind,
    existingContent,
    file.content,
    policy
  );
}
