import type { MigrationFile } from "../types.ts";
import {
  formatObjectRef,
  locationFromOffset,
  PARSER_ID,
  type SchemaObjectRef,
  type SqlSourceLocation,
  type TableRef,
} from "./ast.ts";
import {
  parsePostgresSql,
  pgNameList,
  pgString,
  type PgAstNode,
  walkAst,
} from "./parser.ts";
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
  return undefined;
}

function snippetAt(sql: string, offset: number, length = 48): string {
  const start = Math.max(0, offset);
  return sql.slice(start, start + length).replace(/\s+/g, " ").trim();
}

function tableRef(schema: string | undefined, name: string): TableRef {
  return { kind: "table", name, schema: schema || DEFAULT_SCHEMA };
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

function collectRangeVars(
  node: unknown
): Array<{ alias: string; location: number; table: TableRef }> {
  const found: Array<{ alias: string; location: number; table: TableRef }> = [];
  walkAst(node, (kind, value) => {
    if (kind !== "RangeVar") {
      return;
    }
    const relname = typeof value.relname === "string" ? value.relname : undefined;
    if (!relname) {
      return;
    }
    const schema =
      typeof value.schemaname === "string" ? value.schemaname : DEFAULT_SCHEMA;
    const aliasNode = asRecord(value.alias);
    const alias =
      (aliasNode && typeof aliasNode.aliasname === "string"
        ? aliasNode.aliasname
        : relname) ?? relname;
    found.push({
      alias,
      location: typeof value.location === "number" ? value.location : 0,
      table: tableRef(schema, relname),
    });
  });
  return found;
}

function extractQueryDependencies(
  node: unknown,
  filename: string,
  sql: string,
  baseOffset: number
): SemanticDependency[] {
  const dependencies: SemanticDependency[] = [];
  const ranges = collectRangeVars(node);
  const aliases = new Map<string, TableRef>();
  for (const range of ranges) {
    aliases.set(range.alias, range.table);
    aliases.set(range.table.name, range.table);
    const qualified = range.table.schema
      ? `${range.table.schema}.${range.table.name}`
      : undefined;
    const location = locationFromOffset(
      filename,
      sql,
      baseOffset + range.location
    );
    dependencies.push(
      dep(
        "REQUIRES_TABLE",
        range.table,
        range.table.schema === DEFAULT_SCHEMA && !range.table.schema
          ? "probable"
          : "certain",
        location,
        snippetAt(sql, baseOffset + range.location)
      )
    );
    dependencies.push(
      dep("READS", range.table, "certain", location, snippetAt(sql, baseOffset + range.location))
    );
    dependencies.push(
      dep("REQUIRES_SCHEMA", { kind: "schema", name: range.table.schema }, "certain", location)
    );
    if (qualified) {
      aliases.set(qualified, range.table);
    }
  }

  walkAst(node, (kind, value) => {
    if (kind === "ColumnRef") {
      const fields = Array.isArray(value.fields) ? value.fields : [];
      const names = fields
        .map((field) => pgString(field))
        .filter((item): item is string => Boolean(item));
      if (names.length === 0) {
        return;
      }
      const location = locationFromOffset(
        filename,
        sql,
        baseOffset + (typeof value.location === "number" ? value.location : 0)
      );
      if (names.length >= 2) {
        const column = names[names.length - 1];
        const alias = names[names.length - 2];
        const table = aliases.get(alias);
        if (table) {
          dependencies.push(
            dep(
              "REQUIRES_COLUMN",
              {
                kind: "column",
                name: column,
                schema: table.schema,
                table: table.name,
              },
              "certain",
              location,
              snippetAt(sql, baseOffset + (typeof value.location === "number" ? value.location : 0))
            )
          );
        }
      }
      return;
    }
    if (kind === "FuncCall") {
      const names = pgNameList(value.funcname);
      if (names.length === 0) {
        return;
      }
      const schema = names.length > 1 ? names[0] : DEFAULT_SCHEMA;
      const name = names[names.length - 1];
      if (name === "format") {
        return;
      }
      dependencies.push(
        dep(
          "INVOKES",
          { kind: "function", name, schema },
          names.length > 1 ? "certain" : "probable",
          locationFromOffset(
            filename,
            sql,
            baseOffset + (typeof value.location === "number" ? value.location : 0)
          )
        )
      );
      dependencies.push(
        dep(
          "REQUIRES_FUNCTION",
          { kind: "function", name, schema },
          names.length > 1 ? "certain" : "probable"
        )
      );
      return;
    }
    if (kind === "ExecuteStmt") {
      dependencies.push({
        category: "READS",
        confidence: "dynamic",
        object: { kind: "table", name: "<dynamic>", schema: DEFAULT_SCHEMA },
        snippet: "EXECUTE",
      });
    }
  });

  return dependencies;
}

function defElemArgString(options: unknown, name: string): string | undefined {
  if (!Array.isArray(options)) {
    return undefined;
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
    if (items && items[0]) {
      return pgString(items[0]);
    }
  }
  return undefined;
}

function plpgsqlSqlFragments(body: string): string[] {
  const fragments: string[] = [];
  const pattern =
    /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|RETURN\s+QUERY)\b[\s\S]*?;/gi;
  let match = pattern.exec(body);
  while (match) {
    fragments.push(match[0]);
    match = pattern.exec(body);
  }
  return fragments;
}

function isDynamicBody(body: string): boolean {
  return /\bEXECUTE\b/i.test(body) && /\bformat\s*\(/i.test(body);
}

async function analyzeFunctionBody(
  body: string,
  language: string,
  filename: string,
  sql: string,
  bodyOffset: number
): Promise<{ dependencies: SemanticDependency[]; warnings: string[] }> {
  const warnings: string[] = [];
  const dependencies: SemanticDependency[] = [];
  const fragments =
    language === "plpgsql" ? plpgsqlSqlFragments(body) : [body];
  if (isDynamicBody(body)) {
    dependencies.push({
      category: "READS",
      confidence: "dynamic",
      object: { kind: "table", name: "<dynamic>", schema: DEFAULT_SCHEMA },
      snippet: "EXECUTE format(...)",
    });
    warnings.push("Dynamic SQL detected; static dependency verification incomplete.");
  }
  for (const fragment of fragments) {
    try {
      const parsed = await parsePostgresSql(fragment);
      for (const statement of parsed.statements) {
        dependencies.push(
          ...extractQueryDependencies(statement.node, filename, sql, bodyOffset)
        );
      }
    } catch {
      warnings.push(`Unable to parse ${language} body fragment as SQL.`);
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

function qualifiedName(node: PgAstNode, fallbackSchema = DEFAULT_SCHEMA): {
  name: string;
  schema: string;
} {
  if (typeof node.relname === "string") {
    return {
      name: node.relname,
      schema: typeof node.schemaname === "string" ? node.schemaname : fallbackSchema,
    };
  }
  const names = pgNameList(node);
  if (names.length >= 2) {
    return { schema: names[0], name: names[names.length - 1] };
  }
  return { schema: fallbackSchema, name: names[0] ?? "unknown" };
}

function columnDefs(tableElts: unknown, schema: string, table: string): SchemaObjectRef[] {
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
      const name = typeof node.schemaname === "string" ? node.schemaname : DEFAULT_SCHEMA;
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
        dep("REQUIRES_SCHEMA", { kind: "schema", name: ident.schema }, "certain", loc)
      );
      break;
    }
    case "CreateTableAsStmt": {
      statementKind = "create_table_as";
      const into = asRecord(asRecord(node.into)?.rel) ?? asRecord(node.into);
      const ident = into ? qualifiedName(into) : { name: "unknown", schema: DEFAULT_SCHEMA };
      object = { kind: "table", name: ident.name, schema: ident.schema };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies = extractQueryDependencies(node.query ?? node, filename, sql, location);
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
          const def = asRecord(asRecord(alter.def)?.ColumnDef) ?? asRecord(alter.def);
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
        if (alter.subtype === "AT_DropColumn" && typeof alter.name === "string") {
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
        } else if (removeType.includes("FUNCTION") || removeType === "OBJECT_FUNCTION") {
          statementKind = "drop_function";
          const schema = names.length > 1 ? names[0] : DEFAULT_SCHEMA;
          const name = names[names.length - 1];
          dropped.push({ kind: "function", name, schema });
        } else if (removeType.includes("INDEX") || removeType === "OBJECT_INDEX") {
          statementKind = "drop_index";
          const schema = names.length > 1 ? names[0] : DEFAULT_SCHEMA;
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
        dep("REQUIRES_TABLE", { kind: "table", name: ident.name, schema: ident.schema }, "certain", loc)
      );
      break;
    }
    case "ViewStmt": {
      statementKind = node.relkind === "m" ? "create_materialized_view" : "create_view";
      const view = asRecord(node.view) ?? {};
      const ident = qualifiedName(view);
      object = {
        kind: statementKind === "create_materialized_view" ? "materialized_view" : "view",
        name: ident.name,
        schema: ident.schema,
      };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies = extractQueryDependencies(node.query ?? node, filename, sql, location);
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
      const language = (defElemArgString(node.options, "language") ?? "sql").toLowerCase();
      const body = defElemArgString(node.options, "as") ?? "";
      const bodyOffset = location;
      const analyzed = await analyzeFunctionBody(body, language, filename, sql, bodyOffset);
      dependencies = analyzed.dependencies;
      warnings.push(...analyzed.warnings);
      break;
    }
    case "CreateTrigStmt": {
      statementKind = "create_trigger";
      const relation = asRecord(node.relation) ?? {};
      const ident = qualifiedName(relation);
      const trigName = typeof node.trigname === "string" ? node.trigname : "trigger";
      object = { kind: "trigger", name: trigName, schema: ident.schema, table: ident.name };
      effects = { creates: [object], drops: [], modifies: [] };
      dependencies.push(
        dep("REQUIRES_TABLE", { kind: "table", name: ident.name, schema: ident.schema }, "certain", loc)
      );
      const funcnames = pgNameList(node.funcname);
      if (funcnames.length > 0) {
        dependencies.push(
          dep(
            "REQUIRES_FUNCTION",
            {
              kind: "function",
              name: funcnames[funcnames.length - 1],
              schema: funcnames.length > 1 ? funcnames[0] : DEFAULT_SCHEMA,
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
      statementKind = kind === "CreatePolicyStmt" ? "create_policy" : "alter_policy";
      const table = asRecord(node.table) ?? {};
      const ident = qualifiedName(table);
      const policyName = typeof node.policy_name === "string" ? node.policy_name : "policy";
      object = { kind: "policy", name: policyName, schema: ident.schema, table: ident.name };
      effects = {
        creates: kind === "CreatePolicyStmt" ? [object] : [],
        drops: [],
        modifies: kind === "AlterPolicyStmt" ? [{ kind: "alter_policy", object }] : [],
      };
      dependencies.push(
        dep("REQUIRES_TABLE", { kind: "table", name: ident.name, schema: ident.schema }, "certain", loc)
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
      statementKind = "other";
      const seq = asRecord(node.sequence) ?? {};
      const ident = qualifiedName(seq);
      object = { kind: "sequence", name: ident.name, schema: ident.schema };
      effects = { creates: [object], drops: [], modifies: [] };
      break;
    }
    case "CreateExtensionStmt": {
      statementKind = "create_extension";
      const name = typeof node.extname === "string" ? node.extname : "extension";
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
    default:
      dependencies = extractQueryDependencies(node, filename, sql, location);
      if (kind === "InsertStmt" || kind === "UpdateStmt" || kind === "DeleteStmt") {
        for (const range of collectRangeVars(node)) {
          dependencies.push(dep("WRITES", range.table, "certain", loc));
        }
      }
      break;
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

function uniqueDeps(dependencies: SemanticDependency[]): SemanticDependency[] {
  const seen = new Set<string>();
  const result: SemanticDependency[] = [];
  for (const item of dependencies) {
    const key = `${item.category}:${item.confidence}:${formatObjectRef(item.object)}:${item.object.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
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
  for (const statement of parsed.statements) {
    const analyzed = await analyzeStatement(
      statement.kind,
      statement.node,
      file.filename,
      file.sql,
      statement.location,
      statement.length
    );
    statements.push(analyzed.statement);
    warnings.push(...analyzed.warnings);
  }
  const dependencies = uniqueDeps(statements.flatMap((item) => item.dependencies));
  const effects = mergeEffects(...statements.map((item) => item.effects));
  return {
    checksum: file.checksum,
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
