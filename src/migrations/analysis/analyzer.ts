import type { MigrationFile } from "../types.ts";
import {
  locationFromOffset,
  PARSER_ID,
  type SchemaObjectRef,
  type SqlSourceLocation,
} from "./ast.ts";
import {
  type PgAstNode,
  parsePostgresSql,
  pgNameList,
  pgString,
} from "./parser.ts";
import { parsePlpgsqlBindings } from "./plpgsql-bindings.ts";
import {
  extractQueryDependencies,
  uniqueDeps,
  writeTargetFromNode,
} from "./query-deps.ts";
import type {
  DependencyCategory,
  DependencyConfidence,
  MigrationAnalysis,
  MigrationEffects,
  SemanticDependency,
  SemanticStatement,
  StatementKind,
} from "./semantic-ir.ts";

const DEFAULT_SCHEMA = "public";

function asRecord(value: unknown): PgAstNode | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as PgAstNode;
  }
}

function dep(
  category: DependencyCategory,
  object: SchemaObjectRef,
  confidence: DependencyConfidence,
  location?: SqlSourceLocation,
  snippet?: string
): SemanticDependency {
  return { category, confidence, location, object, snippet };
}

function ownedByNames(options: unknown): string[] | undefined {
  if (!Array.isArray(options)) {
    return;
  }
  for (const option of options) {
    const def = asRecord(asRecord(option)?.DefElem) ?? asRecord(option);
    if (!def || def.defname !== "owned_by") {
      continue;
    }
    const list = asRecord(asRecord(def.arg)?.List);
    const items = Array.isArray(list?.items) ? list.items : [];
    return items
      .map((item) => pgString(item))
      .filter((item): item is string => Boolean(item));
  }
}

function defElemArgString(options: unknown, name: string): string | undefined {
  if (!Array.isArray(options)) {
    return;
  }
  for (const option of options) {
    const def = asRecord(asRecord(option)?.DefElem) ?? asRecord(option);
    if (!def || def.defname !== name) {
      continue;
    }
    const arg = def.arg;
    const direct = pgString(arg);
    if (direct) {
      return direct;
    }
    const list = asRecord(asRecord(arg)?.List);
    const items = Array.isArray(list?.items)
      ? list.items
      : Array.isArray(asRecord(arg)?.items)
        ? (asRecord(arg)?.items as unknown[])
        : undefined;
    const first = items?.[0];
    if (first) {
      return pgString(first);
    }
  }
}

function isSqlWordStart(body: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  return !/[\w$]/u.test(body[index - 1] ?? "");
}

function readDollarTag(body: string, index: number): string | undefined {
  const match = /^\$[A-Za-z0-9_]*\$/u.exec(body.slice(index));
  return match?.[0];
}

/**
 * Advance through SQL so WITH … (SELECT …) … ; stays one statement.
 * Nested SELECT inside CTE parentheses must not start a new fragment.
 */
function endOfSqlStatement(body: string, start: number): number {
  let index = start;
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let dollarTag: string | undefined;
  while (index < body.length) {
    const char = body[index];
    const next = body[index + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (dollarTag) {
      if (body.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = undefined;
        continue;
      }
      index += 1;
      continue;
    }
    if (inSingle) {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (char === "'") {
        inSingle = false;
      }
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      index += 1;
      continue;
    }
    const tag = char === "$" ? readDollarTag(body, index) : undefined;
    if (tag) {
      dollarTag = tag;
      index += tag.length;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === ";" && depth === 0) {
      return index + 1;
    }
    index += 1;
  }
  return -1;
}

function topLevelKeywordIndexes(body: string, keyword: string): number[] {
  const indexes: number[] = [];
  const upper = keyword.toUpperCase();
  let index = 0;
  let depth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let dollarTag: string | undefined;
  while (index < body.length) {
    const char = body[index];
    const next = body[index + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      index += 1;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (dollarTag) {
      if (body.startsWith(dollarTag, index)) {
        index += dollarTag.length;
        dollarTag = undefined;
        continue;
      }
      index += 1;
      continue;
    }
    if (inSingle) {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (char === "'") {
        inSingle = false;
      }
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      inLineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 2;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      index += 1;
      continue;
    }
    const tag = char === "$" ? readDollarTag(body, index) : undefined;
    if (tag) {
      dollarTag = tag;
      index += tag.length;
      continue;
    }
    if (depth === 0 && isSqlWordStart(body, index)) {
      const slice = body.slice(index, index + keyword.length);
      if (slice.toUpperCase() === upper) {
        const after = body[index + keyword.length];
        if (!(after && /[\w$]/u.test(after))) {
          indexes.push(index);
        }
      }
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }
    index += 1;
  }
  return indexes;
}

function functionParameterNames(node: PgAstNode): string[] {
  const lists = [node.parameters, node.params];
  const names: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      const record =
        asRecord(asRecord(item)?.FunctionParameter) ?? asRecord(item);
      if (typeof record?.name === "string" && record.name.length > 0) {
        names.push(record.name);
      }
    }
  }
  return names;
}

function plpgsqlSqlFragments(body: string): string[] {
  const covered: Array<{ end: number; start: number }> = [];
  const fragments: string[] = [];
  for (const start of topLevelKeywordIndexes(body, "WITH")) {
    const end = endOfSqlStatement(body, start);
    if (end <= start) {
      continue;
    }
    fragments.push(body.slice(start, end));
    covered.push({ end, start });
  }
  const pattern =
    /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|RETURN\s+QUERY)\b[\s\S]*?;/gi;
  let match = pattern.exec(body);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    const nested = covered.some(
      (range) => start < range.end && end > range.start
    );
    if (!nested) {
      fragments.push(match[0]);
    }
    match = pattern.exec(body);
  }
  return fragments;
}

function isDynamicBody(body: string): boolean {
  return /\bEXECUTE\b/i.test(body);
}

async function analyzeFunctionBody(
  body: string,
  language: string,
  filename: string,
  sql: string,
  bodyOffset: number,
  parameters: readonly string[] = []
): Promise<{ dependencies: SemanticDependency[]; warnings: string[] }> {
  const warnings: string[] = [];
  const dependencies: SemanticDependency[] = [];
  const proceduralBindings =
    language === "plpgsql" ? parsePlpgsqlBindings(body, parameters) : undefined;
  if (proceduralBindings) {
    for (const table of proceduralBindings.rowVariables.values()) {
      dependencies.push({
        category: "REQUIRES_TABLE",
        confidence: "certain",
        explicitlyQualified: Boolean(table.schema),
        object: table,
        resolution: "exact",
      });
    }
  }
  const fragments = language === "plpgsql" ? plpgsqlSqlFragments(body) : [body];
  if (isDynamicBody(body)) {
    dependencies.push({
      category: "READS",
      confidence: "dynamic",
      object: { kind: "table", name: "<dynamic>", schema: "" },
      resolution: "unverified",
      snippet: "EXECUTE",
    });
    warnings.push(
      "Dynamic SQL detected; static dependency verification incomplete."
    );
  }
  for (const fragment of fragments) {
    try {
      const parsed = await parsePostgresSql(fragment);
      for (const statement of parsed.statements) {
        dependencies.push(
          ...extractQueryDependencies(
            statement.node,
            filename,
            sql,
            bodyOffset,
            { proceduralBindings }
          )
        );
      }
    } catch {
      warnings.push(
        `Unable to parse ${language} body fragment as SQL; treating as unverifiable.`
      );
      dependencies.push({
        category: "READS",
        confidence: "unknown",
        object: { kind: "table", name: "<unverified>", schema: "" },
        resolution: "unverified",
        snippet: fragment.slice(0, 48),
      });
    }
  }
  return { dependencies, warnings };
}

function mergeEffects(...effects: MigrationEffects[]): MigrationEffects {
  const creates: SchemaObjectRef[] = [];
  const drops: SchemaObjectRef[] = [];
  const modifies: MigrationEffects["modifies"] = [];
  for (const effect of effects) {
    creates.push(...effect.creates);
    drops.push(...effect.drops);
    modifies.push(...effect.modifies);
  }
  return { creates, drops, modifies };
}

function emptyEffects(): MigrationEffects {
  return { creates: [], drops: [], modifies: [] };
}

function qualifiedName(
  node: PgAstNode,
  fallbackSchema = DEFAULT_SCHEMA
): {
  name: string;
  schema: string;
} {
  if (typeof node.relname === "string") {
    return {
      name: node.relname,
      schema:
        typeof node.schemaname === "string" ? node.schemaname : fallbackSchema,
    };
  }
  const names = pgNameList(node);
  if (names.length >= 2) {
    return { name: names[names.length - 1], schema: names[0] };
  }
  return { name: names[0] ?? "unknown", schema: fallbackSchema };
}

function columnDefs(
  tableElts: unknown,
  schema: string,
  table: string
): SchemaObjectRef[] {
  if (!Array.isArray(tableElts)) {
    return [];
  }
  const columns: SchemaObjectRef[] = [];
  for (const elt of tableElts) {
    const def = asRecord(asRecord(elt)?.ColumnDef) ?? asRecord(elt);
    if (def && typeof def.colname === "string") {
      columns.push({
        kind: "column",
        name: def.colname,
        schema,
        table,
      });
    }
  }
  return columns;
}

async function analyzeStatement(
  kind: string,
  node: PgAstNode,
  filename: string,
  sql: string,
  location: number,
  length: number
): Promise<{ statement: SemanticStatement; warnings: string[] }> {
  const loc = locationFromOffset(filename, sql, location, length);
  const warnings: string[] = [];
  let statementKind: StatementKind = "other";
  let object: SchemaObjectRef | undefined;
  let effects = emptyEffects();
  let dependencies: SemanticDependency[] = [];

  switch (kind) {
    case "CreateSchemaStmt": {
      statementKind = "create_schema";
      const name =
        typeof node.schemaname === "string" ? node.schemaname : DEFAULT_SCHEMA;
      object = { kind: "schema", name };
      effects = { creates: [object], drops: [], modifies: [] };
      break;
    }
    case "CreateStmt": {
      statementKind = "create_table";
      const relation = asRecord(node.relation) ?? node;
      const ident = qualifiedName(relation);
      object = { kind: "table", name: ident.name, schema: ident.schema };
      const columns = columnDefs(node.tableElts, ident.schema, ident.name);
      effects = {
        creates: [object, { kind: "schema", name: ident.schema }, ...columns],
        drops: [],
        modifies: [],
      };
      dependencies.push(
        dep(
          "REQUIRES_SCHEMA",
          { kind: "schema", name: ident.schema },
          "certain",
          loc
        )
      );
      break;
    }
    case "CreateTableAsStmt": {
      statementKind = "create_table_as";
      const into = asRecord(asRecord(node.into)?.rel) ?? asRecord(node.into);
      const ident = into
        ? qualifiedName(into)
        : { name: "unknown", schema: DEFAULT_SCHEMA };
      object = { kind: "table", name: ident.name, schema: ident.schema };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies = extractQueryDependencies(
        node.query ?? node,
        filename,
        sql,
        location
      );
      break;
    }
    case "AlterTableStmt": {
      statementKind = "alter_table";
      const relation = asRecord(node.relation) ?? node;
      const ident = qualifiedName(relation);
      object = { kind: "table", name: ident.name, schema: ident.schema };
      const modifies: MigrationEffects["modifies"] = [];
      const creates: SchemaObjectRef[] = [];
      const cmds = Array.isArray(node.cmds) ? node.cmds : [];
      for (const cmd of cmds) {
        const alter = asRecord(asRecord(cmd)?.AlterTableCmd) ?? asRecord(cmd);
        if (!alter) {
          continue;
        }
        if (alter.subtype === "AT_AddColumn") {
          const def =
            asRecord(asRecord(alter.def)?.ColumnDef) ?? asRecord(alter.def);
          if (def && typeof def.colname === "string") {
            const column: SchemaObjectRef = {
              kind: "column",
              name: def.colname,
              schema: ident.schema,
              table: ident.name,
            };
            creates.push(column);
            modifies.push({ kind: "add_column", object: column });
          }
        }
        if (
          alter.subtype === "AT_DropColumn" &&
          typeof alter.name === "string"
        ) {
          modifies.push({
            kind: "drop_column",
            object: {
              kind: "column",
              name: alter.name,
              schema: ident.schema,
              table: ident.name,
            },
          });
        }
      }
      effects = { creates, drops: [], modifies };
      dependencies.push(dep("REQUIRES_TABLE", object, "certain", loc));
      dependencies.push(dep("ALTERS", object, "certain", loc));
      break;
    }
    case "DropStmt": {
      const removeType = String(node.removeType ?? "");
      const objects = Array.isArray(node.objects) ? node.objects : [];
      const dropped: SchemaObjectRef[] = [];
      for (const item of objects) {
        const list = asRecord(asRecord(item)?.List);
        const names = pgNameList(list?.items ?? item);
        if (removeType.includes("TABLE") || removeType === "OBJECT_TABLE") {
          statementKind = "drop_table";
          const schema = names.length > 1 ? names[0] : DEFAULT_SCHEMA;
          const name = names[names.length - 1];
          dropped.push({ kind: "table", name, schema });
        } else if (
          removeType.includes("FUNCTION") ||
          removeType === "OBJECT_FUNCTION"
        ) {
          statementKind = "drop_function";
          const schema = names.length > 1 ? names[0] : "";
          const name = names[names.length - 1];
          dropped.push({ kind: "function", name, schema });
        } else if (
          removeType.includes("INDEX") ||
          removeType === "OBJECT_INDEX"
        ) {
          statementKind = "drop_index";
          const schema = names.length > 1 ? names[0] : "";
          const name = names[names.length - 1];
          dropped.push({ kind: "index", name, schema });
        }
      }
      object = dropped[0];
      effects = { creates: [], drops: dropped, modifies: [] };
      break;
    }
    case "IndexStmt": {
      statementKind = "create_index";
      const relation = asRecord(node.relation) ?? {};
      const ident = qualifiedName(relation);
      const indexName =
        typeof node.idxname === "string" ? node.idxname : `${ident.name}_idx`;
      object = {
        kind: "index",
        name: indexName,
        schema: ident.schema,
        table: ident.name,
      };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies.push(
        dep(
          "REQUIRES_TABLE",
          { kind: "table", name: ident.name, schema: ident.schema },
          "certain",
          loc
        )
      );
      break;
    }
    case "ViewStmt": {
      statementKind =
        node.relkind === "m" ? "create_materialized_view" : "create_view";
      const view = asRecord(node.view) ?? {};
      const ident = qualifiedName(view);
      object = {
        kind:
          statementKind === "create_materialized_view"
            ? "materialized_view"
            : "view",
        name: ident.name,
        schema: ident.schema,
      };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies = extractQueryDependencies(
        node.query ?? node,
        filename,
        sql,
        location
      );
      break;
    }
    case "CreateFunctionStmt": {
      const names = pgNameList(node.funcname);
      const schema = names.length > 1 ? names[0] : DEFAULT_SCHEMA;
      const name = names[names.length - 1] ?? "unknown";
      const isProcedure = Boolean(node.is_procedure);
      statementKind = isProcedure ? "create_procedure" : "create_function";
      object = { kind: isProcedure ? "function" : "function", name, schema };
      effects = { creates: [object], drops: [], modifies: [] };
      const language = (
        defElemArgString(node.options, "language") ?? "sql"
      ).toLowerCase();
      const body = defElemArgString(node.options, "as") ?? "";
      const bodyOffset = location;
      const analyzed = await analyzeFunctionBody(
        body,
        language,
        filename,
        sql,
        bodyOffset,
        functionParameterNames(node)
      );
      dependencies = analyzed.dependencies;
      warnings.push(...analyzed.warnings);
      break;
    }
    case "CreateTrigStmt": {
      statementKind = "create_trigger";
      const relation = asRecord(node.relation) ?? {};
      const ident = qualifiedName(relation);
      const trigName =
        typeof node.trigname === "string" ? node.trigname : "trigger";
      object = {
        kind: "trigger",
        name: trigName,
        schema: ident.schema,
        table: ident.name,
      };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies.push(
        dep(
          "REQUIRES_TABLE",
          { kind: "table", name: ident.name, schema: ident.schema },
          "certain",
          loc
        )
      );
      const funcnames = pgNameList(node.funcname);
      if (funcnames.length > 0) {
        dependencies.push(
          dep(
            "REQUIRES_FUNCTION",
            {
              kind: "function",
              name: funcnames[funcnames.length - 1],
              schema: funcnames.length > 1 ? funcnames[0] : "",
            },
            "certain",
            loc
          )
        );
      }
      break;
    }
    case "CreatePolicyStmt":
    case "AlterPolicyStmt": {
      statementKind =
        kind === "CreatePolicyStmt" ? "create_policy" : "alter_policy";
      const table = asRecord(node.table) ?? {};
      const ident = qualifiedName(table);
      const policyName =
        typeof node.policy_name === "string" ? node.policy_name : "policy";
      object = {
        kind: "policy",
        name: policyName,
        schema: ident.schema,
        table: ident.name,
      };
      effects = {
        creates: kind === "CreatePolicyStmt" ? [object] : [],
        drops: [],
        modifies:
          kind === "AlterPolicyStmt" ? [{ kind: "alter_policy", object }] : [],
      };
      dependencies.push(
        dep(
          "REQUIRES_TABLE",
          { kind: "table", name: ident.name, schema: ident.schema },
          "certain",
          loc
        )
      );
      break;
    }
    case "CreateEnumStmt":
    case "CompositeTypeStmt": {
      statementKind = "create_type";
      const typeName = pgNameList(node.typeName ?? node.typname);
      const schema = typeName.length > 1 ? typeName[0] : DEFAULT_SCHEMA;
      const name = typeName[typeName.length - 1] ?? "type";
      object = { kind: "type", name, schema };
      effects = { creates: [object], drops: [], modifies: [] };
      break;
    }
    case "CreateSeqStmt": {
      statementKind = "create_sequence";
      const seq = asRecord(node.sequence) ?? {};
      const ident = qualifiedName(seq);
      object = { kind: "sequence", name: ident.name, schema: ident.schema };
      effects = { creates: [object], drops: [], modifies: [] };
      break;
    }
    case "AlterSeqStmt": {
      const seq = asRecord(node.sequence) ?? {};
      const ident = qualifiedName(seq);
      object = { kind: "sequence", name: ident.name, schema: ident.schema };
      dependencies.push(
        dep(
          "REQUIRES_SEQUENCE",
          { kind: "sequence", name: ident.name, schema: ident.schema },
          "certain",
          loc
        )
      );
      const ownedBy = ownedByNames(node.options);
      if (
        ownedBy &&
        !(ownedBy.length === 1 && ownedBy[0]?.toLowerCase() === "none")
      ) {
        const column = ownedBy[ownedBy.length - 1];
        const table =
          ownedBy.length >= 2 ? ownedBy[ownedBy.length - 2] : undefined;
        const schema =
          ownedBy.length >= 3 ? ownedBy[ownedBy.length - 3] : DEFAULT_SCHEMA;
        if (column && table) {
          dependencies.push(
            dep(
              "REQUIRES_TABLE",
              { kind: "table", name: table, schema },
              "certain",
              loc
            )
          );
          dependencies.push(
            dep(
              "REQUIRES_COLUMN",
              {
                kind: "column",
                name: column,
                schema,
                table,
              },
              "certain",
              loc
            )
          );
        }
      }
      break;
    }
    case "CreateExtensionStmt": {
      statementKind = "create_extension";
      const name =
        typeof node.extname === "string" ? node.extname : "extension";
      object = { kind: "extension", name };
      effects = { creates: [object], drops: [], modifies: [] };
      break;
    }
    case "GrantStmt":
      statementKind = "grant";
      break;
    case "CommentStmt":
      statementKind = "comment";
      break;
    default: {
      dependencies = extractQueryDependencies(node, filename, sql, location);
      if (
        kind === "InsertStmt" ||
        kind === "UpdateStmt" ||
        kind === "DeleteStmt"
      ) {
        const target = writeTargetFromNode(node);
        if (target) {
          object = target.table;
          dependencies.push(
            dep(
              "WRITES",
              target.table,
              target.explicitlyQualified ? "certain" : "probable",
              loc
            )
          );
        }
      }
      break;
    }
  }

  return {
    statement: {
      dependencies,
      effects,
      kind: statementKind,
      location: loc,
      object,
    },
    warnings,
  };
}

function parseMigrationDirectives(sql: string): SchemaObjectRef[] {
  const requires: SchemaObjectRef[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const match = /^\s*--\s*requires-table:\s+([\w.]+)/i.exec(line);
    if (!match?.[1]) {
      continue;
    }
    const parts = match[1].split(".").filter((part) => part.length > 0);
    if (parts.length >= 2) {
      requires.push({
        kind: "table",
        name: parts[parts.length - 1],
        schema: parts[0],
      });
    } else if (parts[0]) {
      requires.push({ kind: "table", name: parts[0], schema: "" });
    }
  }
  return requires;
}

/**
 * Compile one migration file to semantic IR.
 */
export async function analyzeMigrationFile(
  file: MigrationFile
): Promise<MigrationAnalysis> {
  const parsed = await parsePostgresSql(file.sql);
  const statements: SemanticStatement[] = [];
  const warnings: string[] = [];
  let statementIndex = 0;
  for (const statement of parsed.statements) {
    const analyzed = await analyzeStatement(
      statement.kind,
      statement.node,
      file.filename,
      file.sql,
      statement.location,
      statement.length
    );
    const owner = analyzed.statement.object;
    analyzed.statement.dependencies = analyzed.statement.dependencies.map(
      (item) => ({
        ...item,
        owner: item.owner ?? owner,
        statementIndex,
      })
    );
    statements.push(analyzed.statement);
    warnings.push(...analyzed.warnings);
    statementIndex += 1;
  }
  const declaredRequires = parseMigrationDirectives(file.sql);
  const dependencies = uniqueDeps(
    statements.flatMap((item) => item.dependencies)
  );
  const effects = mergeEffects(...statements.map((item) => item.effects));
  return {
    checksum: file.checksum,
    declaredRequires,
    dependencies,
    effects,
    filename: file.filename,
    name: file.name,
    parserId: PARSER_ID,
    statements,
    version: file.version,
    warnings,
  };
}
