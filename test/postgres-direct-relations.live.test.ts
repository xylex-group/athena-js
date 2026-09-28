import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { createAthenaDataHandlers } from "../src/next/data-handlers.ts";
import { createClient } from "../src/index.ts";
import type { ModelRelationMetadata } from "../src/schema/types.ts";

const URI =
  process.env.ATHENA_PG_DIRECT_URI ??
  process.env.ATHENA_TEST_DATABASE_URL ??
  process.env.DATABASE_URL;
const live = {
  skip: !(URI && /^postgres(ql)?:\/\//i.test(URI)),
};
const schema = process.env.ATHENA_TEST_DATABASE_URL
  ? `athena_dragunov_relations_${process.pid}`
  : "athena_dragunov_relations";

function relation(
  kind: ModelRelationMetadata["kind"],
  sourceColumns: string[],
  targetModel: string,
  targetColumns: string[],
  through?: ModelRelationMetadata["through"]
): ModelRelationMetadata {
  return {
    kind,
    sourceColumns,
    targetColumns,
    targetModel,
    targetSchema: schema,
    ...(through ? { through } : {}),
  };
}

function model(
  tableName: string,
  relations: Record<string, ModelRelationMetadata>
) {
  return {
    meta: {
      primaryKey: ["id"],
      relations,
      schema,
      tableName,
    },
  };
}

const models = {
  comments: model("comments", {
    posts: relation("many-to-one", ["post_id"], "posts", ["id"]),
  }),
  composite_parents: model("composite_parents", {
    children: relation("one-to-many", ["tenant_id", "id"], "composite_children", [
      "tenant_id",
      "parent_id",
    ]),
  }),
  organizations: model("organizations", {
    projects: relation("one-to-many", ["id"], "projects", ["org_id"]),
  }),
  posts: model("posts", {
    author: relation("many-to-one", ["author_id"], "users", ["id"]),
    comments: relation("one-to-many", ["id"], "comments", ["post_id"]),
    reviewer: relation("many-to-one", ["reviewer_id"], "users", ["id"]),
    tags: relation("many-to-many", ["id"], "tags", ["id"], {
      model: "post_tags",
      schema,
      sourceColumns: ["post_id"],
      targetColumns: ["tag_id"],
    }),
  }),
  profiles: model("profiles", {
    users: relation("one-to-one", ["user_id"], "users", ["id"]),
  }),
  projects: model("projects", {
    organizations: relation("many-to-one", ["org_id"], "organizations", ["id"]),
    tasks: relation("one-to-many", ["id"], "tasks", ["project_id"]),
  }),
  tags: model("tags", {
    posts: relation("many-to-many", ["id"], "posts", ["id"], {
      model: "post_tags",
      schema,
      sourceColumns: ["tag_id"],
      targetColumns: ["post_id"],
    }),
  }),
  task_comments: model("task_comments", {
    tasks: relation("many-to-one", ["task_id"], "tasks", ["id"]),
  }),
  tasks: model("tasks", {
    comments: relation("one-to-many", ["id"], "task_comments", ["task_id"]),
    projects: relation("many-to-one", ["project_id"], "projects", ["id"]),
  }),
  users: model("users", {
    posts: relation("one-to-many", ["id"], "posts", ["author_id"]),
    profiles: relation("one-to-one", ["id"], "profiles", ["user_id"]),
  }),
};

async function setup(): Promise<void> {
  assert.ok(URI);
  const client = new pg.Client({ connectionString: URI });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.users (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TABLE ${schema}.profiles (
        user_id integer NOT NULL UNIQUE REFERENCES ${schema}.users(id),
        bio text NOT NULL
      );
      CREATE TABLE ${schema}.posts (
        id integer PRIMARY KEY,
        author_id integer REFERENCES ${schema}.users(id),
        reviewer_id integer REFERENCES ${schema}.users(id),
        title text NOT NULL,
        published boolean NOT NULL
      );
      CREATE TABLE ${schema}.comments (
        id integer PRIMARY KEY,
        post_id integer REFERENCES ${schema}.posts(id),
        body text NOT NULL
      );
      CREATE TABLE ${schema}.tags (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TABLE ${schema}.post_tags (
        post_id integer NOT NULL REFERENCES ${schema}.posts(id),
        tag_id integer NOT NULL REFERENCES ${schema}.tags(id),
        PRIMARY KEY (post_id, tag_id)
      );
      CREATE TABLE ${schema}.composite_parents (
        tenant_id integer NOT NULL,
        id integer NOT NULL,
        name text NOT NULL,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE ${schema}.composite_children (
        id integer PRIMARY KEY,
        tenant_id integer NOT NULL,
        parent_id integer NOT NULL,
        label text NOT NULL,
        FOREIGN KEY (tenant_id, parent_id)
          REFERENCES ${schema}.composite_parents(tenant_id, id)
      );
      CREATE TABLE ${schema}.organizations (
        id integer PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE ${schema}.projects (
        id integer PRIMARY KEY,
        org_id integer NOT NULL REFERENCES ${schema}.organizations(id),
        name text NOT NULL
      );
      CREATE TABLE ${schema}.tasks (
        id integer PRIMARY KEY,
        project_id integer NOT NULL REFERENCES ${schema}.projects(id),
        name text NOT NULL
      );
      CREATE TABLE ${schema}.task_comments (
        id integer PRIMARY KEY,
        task_id integer NOT NULL REFERENCES ${schema}.tasks(id),
        body text NOT NULL
      );
      INSERT INTO ${schema}.users VALUES (1, 'ada'), (2, 'bez');
      INSERT INTO ${schema}.profiles VALUES (1, 'bio-ada');
      INSERT INTO ${schema}.posts VALUES
        (10, 1, 2, 'first', true),
        (11, 1, NULL, 'draft', false),
        (12, 2, 1, 'other', true);
      INSERT INTO ${schema}.comments VALUES (100, 10, 'hello'), (101, 10, 'world');
      INSERT INTO ${schema}.tags VALUES (5, 'blue'), (6, 'green');
      INSERT INTO ${schema}.post_tags VALUES (10, 5), (10, 6), (11, 5);
      INSERT INTO ${schema}.composite_parents VALUES (1, 7, 'one'), (2, 7, 'two');
      INSERT INTO ${schema}.composite_children VALUES (20, 1, 7, 'matching');
      INSERT INTO ${schema}.organizations VALUES (1, 'acme');
      INSERT INTO ${schema}.projects VALUES (1, 1, 'p1');
      INSERT INTO ${schema}.tasks VALUES (1, 1, 't1');
      INSERT INTO ${schema}.task_comments VALUES (1, 1, 'note');
    `);
  } finally {
    await client.end();
  }
}

test(
  "direct PostgreSQL relational execution preserves nested arrays and nulls",
  live,
  async () => {
    await setup();
    assert.ok(URI);
    const athena = createClient({ databaseUrl: URI, env: {} });
    const { data, error } = await athena.from(`${schema}.users`).findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        posts: {
          constraint: "author_id",
          orderBy: { id: "asc" },
          select: { id: true, title: true },
        },
      },
    });

    assert.equal(error, null, String(error ?? ""));
    assert.deepEqual(data, [
      {
        id: 1,
        name: "ada",
        posts: [
          { id: 10, title: "first" },
          { id: 11, title: "draft" },
        ],
      },
      { id: 2, name: "bez", posts: [{ id: 12, title: "other" }] },
    ]);

    const childResult = await athena.from(`${schema}.posts`).findMany({
      orderBy: { id: "asc" },
      select: {
        users: {
          as: "author",
          constraint: "author_id",
          select: { id: true, name: true },
        },
        id: true,
        title: true,
      },
    });
    assert.equal(childResult.error, null, String(childResult.error ?? ""));
    assert.deepEqual(childResult.data, [
      { author: { id: 1, name: "ada" }, id: 10, title: "first" },
      { author: { id: 1, name: "ada" }, id: 11, title: "draft" },
      { author: { id: 2, name: "bez" }, id: 12, title: "other" },
    ]);
  }
);

test(
  "discovered 1:1, aliases, First, Natural limit, and structural nulls",
  live,
  async () => {
    await setup();
    assert.ok(URI);
    const athena = createClient({ databaseUrl: URI, env: {} });

    const profiles = await athena.from(`${schema}.users`).findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        profiles: { select: { bio: true } },
      },
    });
    assert.equal(profiles.error, null, String(profiles.error ?? ""));
    assert.deepEqual(profiles.data, [
      { id: 1, profiles: { bio: "bio-ada" } },
      { id: 2, profiles: null },
    ]);

    const limited = await athena.from(`${schema}.users`).findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        posts: {
          constraint: "author_id",
          limit: 1,
          orderBy: { id: "asc" },
          select: { title: true },
        },
      },
    });
    assert.equal(limited.error, null, String(limited.error ?? ""));
    assert.ok(Array.isArray((limited.data as { posts: unknown }[])[0]?.posts));
    assert.equal((limited.data as { posts: unknown[] }[])[0]?.posts.length, 1);

    const first = await athena.from(`${schema}.users`).findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        posts: {
          as: "latestChild",
          constraint: "author_id",
          offset: 1,
          orderBy: { id: "asc" },
          select: { title: true },
          selection: "first",
        },
      },
    } as never);
    assert.equal(first.error, null, String(first.error ?? ""));
    assert.deepEqual(first.data, [
      { id: 1, latestChild: { title: "draft" } },
      { id: 2, latestChild: null },
    ]);
  }
);

test("composite keys, depth 3, predicates, and model M:N", live, async () => {
  await setup();
  assert.ok(URI);
  const direct = createClient({ databaseUrl: URI, env: {}, models });
  const handlers = createAthenaDataHandlers({
    databaseUrl: URI,
    models,
    security: { mode: "trusted" },
    unsafeAllowUnauthenticated: true,
  });

  const composite = await direct.from(`${schema}.composite_parents`).findMany({
    orderBy: { name: "asc" },
    select: {
      children: { select: { label: true } },
      name: true,
    },
  });
  assert.equal(composite.error, null, String(composite.error ?? ""));
  assert.deepEqual(composite.data, [
    { children: [{ label: "matching" }], name: "one" },
    { children: [], name: "two" },
  ]);

  const depth = await direct.from(`${schema}.organizations`).findMany({
    select: {
      name: true,
      projects: {
        select: {
          name: true,
          tasks: {
            select: {
              comments: { select: { body: true } },
              name: true,
            },
          },
        },
      },
    },
  });
  assert.equal(depth.error, null, String(depth.error ?? ""));
  assert.deepEqual(depth.data, [
    {
      name: "acme",
      projects: [
        {
          name: "p1",
          tasks: [{ comments: [{ body: "note" }], name: "t1" }],
        },
      ],
    },
  ]);

  const some = await direct.from(`${schema}.users`).findMany({
    orderBy: { id: "asc" },
    select: { id: true },
    where: { posts: { some: { published: { eq: true } } } },
  });
  assert.equal(some.error, null, String(some.error ?? ""));
  assert.deepEqual(some.data, [{ id: 1 }, { id: 2 }]);

  const tags = await direct.from(`${schema}.posts`).findMany({
    orderBy: { id: "asc" },
    select: {
      tags: { orderBy: { name: "asc" }, select: { name: true } },
      title: true,
    },
  });
  assert.equal(tags.error, null, String(tags.error ?? ""));
  assert.deepEqual(tags.data, [
    { tags: [{ name: "blue" }, { name: "green" }], title: "first" },
    { tags: [{ name: "blue" }], title: "draft" },
    { tags: [], title: "other" },
  ]);

  const reverse = await direct.from(`${schema}.tags`).findMany({
    orderBy: { name: "asc" },
    select: {
      name: true,
      posts: { orderBy: { title: "asc" }, select: { title: true } },
    },
  });
  assert.equal(reverse.error, null, String(reverse.error ?? ""));
  assert.equal((reverse.data as { name: string }[])[0]?.name, "blue");

  const request = new Request("http://localhost/api/athena/gateway/fetch", {
    body: JSON.stringify({
      orderBy: { id: "asc" },
      select: {
        tags: { orderBy: { name: "asc" }, select: { name: true } },
        title: true,
      },
      table_name: `${schema}.posts`,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const response = await handlers.POST(request);
  const body = (await response.json()) as {
    data?: unknown;
    error?: unknown;
    ok?: boolean;
  };
  assert.equal(body.ok, true, JSON.stringify(body.error));
  assert.deepEqual(body.data, tags.data);
});
