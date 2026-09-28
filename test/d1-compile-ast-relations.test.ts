import { strict as assert } from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { compileD1Ast } from "../src/cloudflare/d1/compile-ast.ts";
import {
  AthenaQueryError,
  type AthenaRelationCatalog,
  normalizeFindManyInput,
  resolveQueryPlan,
} from "../src/query/engine/index.ts";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (filename: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
    };
  };
};

const catalog: AthenaRelationCatalog = {
  entries: [
    {
      cardinality: "one-to-many",
      from: { columns: ["id"], table: "users" },
      id: "users.posts",
      name: "posts",
      to: { columns: ["user_id"], table: "posts" },
    },
    {
      cardinality: "many-to-many",
      from: { columns: ["id"], table: "users" },
      id: "users.roles",
      junction: {
        fromColumns: ["user_id"],
        table: "user_roles",
        toColumns: ["role_id"],
      },
      name: "roles",
      to: { columns: ["id"], table: "roles" },
    },
  ],
};

function compile(input: {
  select: Record<string, unknown>;
  where?: Record<string, unknown>;
}) {
  const ast = normalizeFindManyInput({
    select: input.select as never,
    table: "users",
    where: input.where,
  });
  return compileD1Ast(resolveQueryPlan(ast, { catalog }));
}

function executePredicate(where: Record<string, unknown>): string[] {
  const compiled = compile({ select: { id: true }, where });
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE posts (id TEXT PRIMARY KEY, user_id TEXT, published INTEGER);
    INSERT INTO users VALUES ('empty'), ('populated');
    INSERT INTO posts VALUES ('post-1', 'populated', 1);
  `);
  const rows = db.prepare(compiled.sql).all(...compiled.params) as Array<{
    id: string;
  }>;
  return rows.map((row) => row.id);
}

test("D1 some compiles to correlated EXISTS with ? binds", () => {
  const compiled = compile({
    select: { id: true },
    where: { posts: { some: { published: true } } },
  });
  assert.match(compiled.sql, /EXISTS \(/);
  assert.match(compiled.sql, /"t1"\."id" = "r\d+"\."user_id"/);
  assert.match(compiled.sql, /"published" = \?/);
  assert.deepEqual(compiled.params, [true]);
});

test("D1 every uses CASE rather than IS NOT TRUE", () => {
  const compiled = compile({
    select: { id: true },
    where: { posts: { every: { published: true } } },
  });
  assert.match(compiled.sql, /NOT EXISTS \(/);
  assert.match(compiled.sql, /CASE WHEN/);
  assert.doesNotMatch(compiled.sql, /IS NOT TRUE/);
  assert.deepEqual(compiled.params, [true]);
});

test("D1 many-to-many nested selection joins the junction once", () => {
  const compiled = compile({
    select: {
      id: true,
      roles: {
        limit: 5,
        select: { name: true },
      },
    },
  });
  assert.match(compiled.sql, /json_group_array/);
  assert.match(compiled.sql, /JOIN "user_roles" AS "/);
  assert.match(compiled.sql, /LIMIT 5/);
  assert.doesNotMatch(compiled.sql, /for \(.*of/);
});

test("D1 nested to-many rows remain JSON objects after aggregation", () => {
  const compiled = compile({
    select: {
      id: true,
      roles: {
        select: { name: true },
      },
    },
  });
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE user_roles (user_id TEXT, role_id TEXT);
    INSERT INTO users VALUES ('user-1');
    INSERT INTO roles VALUES ('role-1', 'admin'), ('role-2', 'editor');
    INSERT INTO user_roles VALUES ('user-1', 'role-1'), ('user-1', 'role-2');
  `);

  const rows = db.prepare(compiled.sql).all(...compiled.params) as Array<{
    id: string;
    roles: string;
  }>;
  assert.equal(rows.length, 1);
  assert.deepEqual(JSON.parse(rows[0]?.roles ?? ""), [
    { name: "admin" },
    { name: "editor" },
  ]);
});

test("D1 nested to-many relations return an empty JSON array without children", () => {
  const compiled = compile({
    select: {
      id: true,
      roles: {
        select: { name: true },
      },
    },
  });
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE user_roles (user_id TEXT, role_id TEXT);
    INSERT INTO users VALUES ('user-without-roles');
  `);

  const rows = db.prepare(compiled.sql).all(...compiled.params) as Array<{
    id: string;
    roles: string;
  }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { id: "user-without-roles", roles: "[]" },
  ]);
});

test("D1 nested to-one relations return null when the foreign key has no match", () => {
  const toOneCatalog: AthenaRelationCatalog = {
    entries: [
      {
        cardinality: "many-to-one",
        from: { columns: ["author_id"], table: "posts" },
        id: "posts.author",
        name: "author",
        to: { columns: ["id"], table: "users" },
      },
    ],
  };
  const ast = normalizeFindManyInput({
    select: {
      author: { select: { id: true } },
      id: true,
    },
    table: "posts",
  });
  const compiled = compileD1Ast(resolveQueryPlan(ast, { catalog: toOneCatalog }));
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE posts (id TEXT PRIMARY KEY, author_id TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    INSERT INTO posts VALUES ('post-without-author', 'missing-user');
  `);

  const rows = db.prepare(compiled.sql).all(...compiled.params) as Array<{
    author: string | null;
    id: string;
  }>;
  assert.deepEqual(rows.map((row) => ({ ...row })), [
    { author: null, id: "post-without-author" },
  ]);
});

test("D1 relation predicates preserve empty-set truth semantics", () => {
  assert.deepEqual(
    executePredicate({ posts: { some: {} } }),
    ["populated"],
    "some matches only the populated parent"
  );
  assert.deepEqual(
    executePredicate({ posts: { none: {} } }),
    ["empty"],
    "none matches only the empty parent"
  );
  assert.deepEqual(
    executePredicate({ posts: { every: {} } }),
    ["empty", "populated"],
    "unconstrained every matches empty and populated parents"
  );
  assert.deepEqual(
    executePredicate({ posts: { exists: true } }),
    ["populated"],
    "exists matches only the populated parent"
  );
});

test("D1 compare with null after normalize fails closed", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { name: { eq: "ok" } },
  });
  const plan = resolveQueryPlan(ast, { catalog });
  if (plan.filter?.kind === "compare") {
    (plan.filter as { value: unknown }).value = null;
  }
  assert.throws(
    () => compileD1Ast(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_INVALID_NORMALIZED_AST"
  );
});
