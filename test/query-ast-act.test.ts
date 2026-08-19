/**
 * ACT-QRY-01…14 — Athena Query AST architecture conformance.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import {
  serializeGatewayAst,
  serializeGatewayPlan,
} from "../src/gateway/serialize-ast.ts";
import { compilePostgresAst } from "../src/postgres/compile-ast.ts";
import {
  AthenaQueryError,
  type AthenaRelationCatalog,
  D1_QUERY_CAPABILITIES,
  normalizeFindManyInput,
  resetQueryPlanAliases,
  resolveAthenaQueryPlan,
  resolveQueryPlan,
  validatePlanAgainstCapabilities,
} from "../src/query/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const srcRoot = join(here, "../src");

type FindManyInput = Parameters<typeof normalizeFindManyInput>[0];

function findManyInput(
  base: FindManyInput,
  override: Partial<FindManyInput> = {},
): FindManyInput {
  return { ...base, ...override };
}

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

const catalog: AthenaRelationCatalog = {
  entries: [
    {
      cardinality: "many-to-one",
      from: { columns: ["section_id"], table: "instruments" },
      id: "instruments.section_id",
      name: "orchestral_sections",
      to: { columns: ["id"], table: "orchestral_sections" },
    },
  ],
};

const fixture = JSON.parse(
  readFileSync(
    join(repoRoot, "test/fixtures/query-ast/orchestral-find-many.json"),
    "utf8",
  ),
) as { input: FindManyInput };

test("ACT-QRY-01: no second client constructors", () => {
  const client =
    readSrc("index.ts") + readSrc("v3-client.ts") + readSrc("client.ts");
  assert.equal(client.includes("createPostgresClient"), false);
  assert.equal(client.includes("createAstClient"), false);
  assert.equal(client.includes("createLocalClient"), false);
});

test("ACT-QRY-02/04/05: same findMany input normalizes and resolves for every backend", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput(fixture.input);
  assert.equal(ast.kind, "select");
  assert.equal(JSON.stringify(ast).includes("SELECT "), false);
  assert.equal(JSON.stringify(ast).includes("$1"), false);
  const plan = resolveAthenaQueryPlan(ast, { catalog });
  assert.equal(plan.kind, "resolved-select");
  assert.equal(
    plan.selection.some((field) => field.kind === "relation"),
    true,
  );
  assert.doesNotThrow(() => compilePostgresAst(plan));
  assert.doesNotThrow(() => compileD1Ast(plan));
  assert.doesNotThrow(() => serializeGatewayPlan(plan));
});

test("ACT-QRY-03: public builders do not branch on backend", () => {
  const source = readSrc("client.ts");
  assert.equal(/if\s*\([^)]*\bpostgres\b/i.test(source), false);
  assert.equal(/if\s*\([^)]*\bd1\b/i.test(source), false);
  assert.equal(/if\s*\([^)]*\bgateway\b/i.test(source), false);
});

test("ACT-QRY-06: compilers consume a resolved plan, not a public select bag", () => {
  const plan = resolveQueryPlan(normalizeFindManyInput(fixture.input), {
    catalog,
  });
  assert.equal(plan.kind, "resolved-select");
  assert.throws(() =>
    compilePostgresAst({ select: fixture.input.select } as never),
  );
});

test("ACT-QRY-07: AST fixture is SQL-free", () => {
  const raw = readFileSync(
    join(repoRoot, "test/fixtures/query-ast/orchestral-find-many.json"),
    "utf8",
  );
  assert.equal(/\$\d/.test(raw), false);
  assert.equal(raw.includes("JOIN "), false);
  assert.equal(/\?\s*,/.test(raw), false);
});

test("ACT-QRY-08: user values only appear in bind arrays", () => {
  resetQueryPlanAliases();
  const ast = normalizeFindManyInput(
    findManyInput(fixture.input, {
      where: { name: { eq: "Brass'; drop table instruments;--" } },
    }),
  );
  const plan = resolveQueryPlan(ast, { catalog });
  const pg = compilePostgresAst(plan);
  const d1 = compileD1Ast(plan);
  assert.equal(pg.text.includes("Brass"), false);
  assert.equal(d1.sql.includes("Brass"), false);
  assert.deepEqual(pg.values, ["Brass'; drop table instruments;--"]);
  assert.deepEqual(d1.params, ["Brass'; drop table instruments;--"]);
  assert.match(pg.text, /\$1/);
  assert.match(d1.sql, /\?/);
});

test("ACT-QRY-09: poisoned identifiers fail closed", () => {
  assert.throws(
    () =>
      normalizeFindManyInput({
        select: { name: true },
        table: 'users"; drop',
      }),
    AthenaQueryError,
  );
});

test("ACT-QRY-11: unsupported capability is typed", () => {
  resetQueryPlanAliases();
  const plan = resolveQueryPlan(normalizeFindManyInput(fixture.input), {
    catalog,
  });
  assert.throws(
    () =>
      validatePlanAgainstCapabilities(plan, {
        ...D1_QUERY_CAPABILITIES,
        nestedRelations: false,
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY",
  );
});

test("ACT-QRY-12: nested to-many is one statement", () => {
  resetQueryPlanAliases();
  const compiled = compilePostgresAst(
    resolveQueryPlan(normalizeFindManyInput(fixture.input), { catalog }),
  );
  assert.match(compiled.text, /json_agg/);
  assert.doesNotMatch(compiled.text, /for\s*\(/);
  assert.equal(compiled.text.split(";").filter(Boolean).length, 1);
});

test("ACT-QRY-14: resolver does not guess joins by table length", () => {
  const source = readSrc("query/engine/relations.ts");
  assert.equal(source.includes("table.length"), false);
  assert.equal(/similarity|levenshtein/i.test(source), false);
});

test("serializeGatewayAst stays a valid fetch body for the same AST", () => {
  const ast = normalizeFindManyInput(fixture.input);
  const wire = serializeGatewayAst(ast);
  assert.equal(wire.table_name, "orchestral_sections");
  assert.equal(typeof wire.select, "string");
  assert.match(String(wire.select), /instruments/);
});
