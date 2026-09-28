import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
  AthenaQueryError,
  type AthenaRelationCatalog,
  canonicalIdentity,
  catalogFromModelRelations,
  normalizeFindFirstInput,
  normalizeFindManyInput,
  normalizeFindUniqueInput,
  parseSelectList,
  mergeRelationCatalogs,
  resolveRelation,
  resolveQueryPlan,
  serializeRelationalQueryV1,
  validateQueryComplexity,
} from "../src/query/engine/index.ts";
import type { AthenaWhere } from "../src/query-ast.ts";

const catalog: AthenaRelationCatalog = {
  entries: [
    {
      cardinality: "one-to-many",
      from: { columns: ["id"], table: "users" },
      id: "users.posts",
      name: "posts",
      constraint: "posts_user_id_fkey",
      to: { columns: ["user_id"], table: "posts" },
    },
    {
      cardinality: "one-to-many",
      from: { columns: ["id"], table: "posts" },
      id: "posts.comments",
      name: "comments",
      constraint: "comments_post_id_fkey",
      to: { columns: ["post_id"], table: "comments" },
    },
    {
      cardinality: "many-to-one",
      constraint: "posts_author_id_fkey",
      from: { columns: ["author_id"], table: "posts" },
      id: "posts.author",
      name: "author",
      to: { columns: ["id"], table: "users" },
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
      constraint: "user_roles_user_id_fkey",
      to: { columns: ["id"], table: "roles" },
    },
  ],
};

const canonicalCatalog: AthenaRelationCatalog = {
  entries: catalog.entries.map((entry) => ({
    ...entry,
    constraint: entry.constraint
      ? canonicalIdentity(
          "constraint",
          "model",
          entry.from.schema,
          entry.from.table,
          entry.constraint
        )
      : undefined,
    id: canonicalIdentity(
      "relation",
      "model",
      entry.from.schema,
      entry.from.table,
      entry.name
    ),
  })),
};

test("normalizeWhere lifts some/none/every into relation condition AST", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: {
      posts: {
        some: { published: true },
      },
    },
  });
  assert.equal(ast.filter?.kind, "relation");
  if (ast.filter?.kind !== "relation") {
    return;
  }
  assert.equal(ast.filter.relation, "posts");
  assert.equal(ast.filter.predicate, "some");
  assert.equal(ast.filter.filter?.kind, "compare");
});

test("eq true and published: true normalize equivalently under some", () => {
  const shorthand = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { posts: { some: { published: true } } },
  });
  const explicit = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { posts: { some: { published: { eq: true } } } },
  });
  assert.deepEqual(shorthand.filter, explicit.filter);
});

test("to-one is/isNot normalize as relation predicates", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "posts",
    where: { author: { is: { active: true } } },
  });
  assert.equal(ast.filter?.kind, "relation");
  if (ast.filter?.kind === "relation") {
    assert.equal(ast.filter.predicate, "is");
    assert.equal(ast.filter.relation, "author");
  }
});

test("relational serializer emits the snake-case to-one isNot quantifier", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "posts",
      where: { author: { isNot: { active: true } } },
    }),
    { catalog: canonicalCatalog }
  );

  assert.deepEqual(serializeRelationalQueryV1(plan).relation_predicates, [
    {
      predicate: {
        field: "active",
        kind: "comparison",
        operator: "eq",
        value: true,
      },
      quantifier: "is_not",
      relation: {
        constraint: "constraint:v1/model//posts/posts_author_id_fkey",
        direction: "forward",
        relation: "relation:v1/model//posts/author",
        target: { schema: undefined, table: "users" },
      },
    },
  ]);
});

test("scalar is: null remains a column null check", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { deleted_at: { is: null } },
  });
  assert.equal(ast.filter?.kind, "is-null");
});

test("empty some/none/every have defined existence semantics", () => {
  const some = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { posts: { some: {} } },
  });
  const none = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { posts: { none: {} } },
  });
  const every = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: { posts: { every: {} } },
  });
  assert.equal(some.filter?.kind, "relation");
  assert.equal(none.filter?.kind, "relation");
  assert.equal(every.filter?.kind, "relation");
  if (some.filter?.kind === "relation") {
    assert.equal(some.filter.predicate, "some");
    assert.equal(some.filter.filter, undefined);
  }
});

test("cyclic where objects fail closed", () => {
  const where: Record<string, unknown> = {};
  where.self = where;
  assert.throws(
    () =>
      normalizeFindManyInput({
        select: { id: true },
        table: "users",
        where,
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_CYCLIC_INPUT"
  );
});

test("resolveQueryPlan resolves nested relation predicates and many-to-many", () => {
  const ast = normalizeFindManyInput({
    select: {
      id: true,
      roles: { select: { name: true } },
    },
    table: "users",
    where: {
      posts: {
        some: {
          comments: { some: { approved: true } },
        },
      },
    },
  });

  const plan = resolveQueryPlan(ast, { catalog });
  assert.equal(plan.filter?.kind, "resolved-relation");
  if (plan.filter?.kind !== "resolved-relation") {
    return;
  }
  assert.equal(plan.filter.descriptor.name, "posts");
  assert.equal(plan.filter.predicate, "some");
  assert.equal(plan.filter.filter?.kind, "resolved-relation");
  const roles = plan.selection.find((field) => field.kind === "relation");
  assert.ok(roles && roles.kind === "relation");
  assert.equal(roles.descriptor.cardinality, "many-to-many");
  assert.ok(roles.junctionAlias);
});

test("relational serializer preserves nested selections, joins, ordering, and pagination", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      limit: 5,
      offset: 2,
      orderBy: { id: "desc" },
      select: {
        id: true,
        posts: {
          join: "inner",
          limit: 3,
          offset: 1,
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        },
      },
      table: "users",
      where: { active: true },
    }),
    { catalog: canonicalCatalog }
  );

  const request = serializeRelationalQueryV1(plan);
  assert.deepEqual(request.pagination, { limit: 5, offset: 2 });
  assert.deepEqual(request.order_by, [{ direction: "desc", field: "id" }]);
  assert.deepEqual(request.predicate, {
    field: "active",
    kind: "comparison",
    operator: "eq",
    value: true,
  });
  assert.equal(request.relations.length, 1);
  assert.deepEqual(request.relations[0], {
    alias: "posts",
    fields: [
      { alias: undefined, field: "id" },
      { alias: undefined, field: "title" },
    ],
    join: "inner",
    order_by: [{ direction: "asc", field: "title" }],
    pagination: { limit: 3, offset: 1 },
    predicate: undefined,
    relation: {
      constraint: "constraint:v1/model//users/posts_user_id_fkey",
      direction: "forward",
      relation: "relation:v1/model//users/posts",
      target: { schema: undefined, table: "posts" },
    },
    relation_predicates: [],
    relations: [],
  });
});

test("P1 Badge: Subtract one when serializing page offsets", () => {
  const pageOne = resolveQueryPlan(
    normalizeFindManyInput({
      currentPage: 1,
      pageSize: 20,
      select: { id: true },
      table: "users",
    }),
    { catalog: canonicalCatalog }
  );
  const pageTwo = resolveQueryPlan(
    normalizeFindManyInput({
      currentPage: 2,
      pageSize: 20,
      select: { id: true },
      table: "users",
    }),
    { catalog: canonicalCatalog }
  );

  assert.deepEqual(serializeRelationalQueryV1(pageOne).pagination, {
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(serializeRelationalQueryV1(pageTwo).pagination, {
    limit: 20,
    offset: 20,
  });
});

test("relational serializer puts IN operands in values", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "users",
      where: { id: { in: [1, 2] } },
    }),
    { catalog: canonicalCatalog }
  );

  assert.deepEqual(serializeRelationalQueryV1(plan).predicate, {
    field: "id",
    kind: "comparison",
    operator: "in",
    values: [1, 2],
  });
});

test("relational serializer splits top-level relation conjunctions", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "users",
      where: {
        active: true,
        posts: { some: { published: true } },
      },
    }),
    { catalog: canonicalCatalog }
  );

  const request = serializeRelationalQueryV1(plan);
  assert.deepEqual(request.predicate, {
    field: "active",
    kind: "comparison",
    operator: "eq",
    value: true,
  });
  assert.deepEqual(request.relation_predicates, [
    {
      predicate: {
        field: "published",
        kind: "comparison",
        operator: "eq",
        value: true,
      },
      quantifier: "some",
      relation: {
        constraint: "constraint:v1/model//users/posts_user_id_fkey",
        direction: "forward",
        relation: "relation:v1/model//users/posts",
        target: { schema: undefined, table: "posts" },
      },
    },
  ]);
});

test("relational serializer maps containedBy to the Rust wire operator", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "users",
      where: { tags: { containedBy: ["a", "b"] } },
    }),
    { catalog: canonicalCatalog }
  );

  assert.deepEqual(serializeRelationalQueryV1(plan).predicate, {
    field: "tags",
    kind: "comparison",
    operator: "contained_by",
    value: ["a", "b"],
  });
});

test("relational serializer matches the shared Rust wire fixture", async () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "users",
      where: {
        active: true,
        id: { in: [1, 2] },
        posts: { isNot: {} },
        tags: { containedBy: ["a", "b"] },
      },
    }),
    { catalog: canonicalCatalog }
  );
  const request = serializeRelationalQueryV1(plan);
  const fixture = JSON.parse(
    await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../../../contracts/query/relational-request-v1-filtered.json", import.meta.url),
        "utf8"
      )
    )
  );

  assert.deepEqual(JSON.parse(JSON.stringify(request)), fixture);
});

test("relational serializer canonicalizes legacy relation identities", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: {
        id: true,
        posts: { select: { id: true } },
      },
      table: "users",
      where: { posts: { some: { published: true } } },
    }),
    { catalog }
  );

  const request = serializeRelationalQueryV1(plan);
  assert.equal(
    request.relations[0]?.relation.relation,
    "relation:v1/model//users/posts"
  );
  assert.equal(
    request.relations[0]?.relation.constraint,
    "constraint:v1/model//users/posts_user_id_fkey"
  );
  assert.equal(
    request.relation_predicates[0]?.relation.relation,
    "relation:v1/model//users/posts"
  );
  assert.equal(
    request.relation_predicates[0]?.relation.constraint,
    "constraint:v1/model//users/posts_user_id_fkey"
  );
});

test("relational serializer rejects relation predicates nested in disjunctions", () => {
  const plan = resolveQueryPlan(
    normalizeFindManyInput({
      select: { id: true },
      table: "users",
      where: {
        or: [{ active: true }, { posts: { some: { published: true } } }],
      },
    }),
    { catalog }
  );

  assert.throws(
    () => serializeRelationalQueryV1(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("relational serializer fails closed for findFirst cardinality", () => {
  const plan = resolveQueryPlan(
    normalizeFindFirstInput({
      select: { id: true },
      table: "users",
    }),
    { catalog: canonicalCatalog }
  );

  assert.throws(
    () => serializeRelationalQueryV1(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("relational serializer fails closed for findUnique cardinality", () => {
  const plan = resolveQueryPlan(
    normalizeFindUniqueInput({
      select: { id: true },
      table: "users",
    }),
    { catalog: canonicalCatalog }
  );

  assert.throws(
    () => serializeRelationalQueryV1(plan),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNSUPPORTED_CAPABILITY"
  );
});

test("reverse many-to-many resolution reverses junction key orientation", () => {
  const descriptor = resolveRelation({
    catalog,
    name: "users",
    source: { kind: "table", table: "roles" },
    targetHint: { kind: "table", table: "users" },
  });

  assert.equal(descriptor.cardinality, "many-to-many");
  assert.deepEqual(descriptor.from, { columns: ["id"], table: "roles" });
  assert.deepEqual(descriptor.to, { columns: ["id"], table: "users" });
  assert.deepEqual(descriptor.junction, {
    fromColumns: ["role_id"],
    table: "user_roles",
    toColumns: ["user_id"],
  });
});

test("relation orientation is an involution for many-to-many metadata", () => {
  const original = {
    cardinality: "many-to-many" as const,
    from: { columns: ["id"], table: "roles" },
    id: "roles.users",
    junction: {
      fromColumns: ["role_id"],
      table: "user_roles",
      toColumns: ["user_id"],
    },
    name: "users",
    to: { columns: ["id"], table: "users" },
  };
  const reverseCatalog: AthenaRelationCatalog = {
    entries: [
      original,
      {
        ...original,
        from: original.to,
        id: "users.roles",
        junction: {
          ...original.junction,
          fromColumns: original.junction.toColumns,
          toColumns: original.junction.fromColumns,
        },
        name: "roles",
        to: original.from,
      },
    ],
  };

  const forward = resolveRelation({
    catalog: reverseCatalog,
    name: "users",
    source: { kind: "table", table: "roles" },
    targetHint: { kind: "table", table: "users" },
  });
  const backward = resolveRelation({
    catalog: reverseCatalog,
    name: "roles",
    source: { kind: "table", table: "users" },
    targetHint: { kind: "table", table: "roles" },
  });

  assert.deepEqual(forward.from, original.from);
  assert.deepEqual(forward.to, original.to);
  assert.deepEqual(backward.from, original.to);
  assert.deepEqual(backward.to, original.from);
  assert.deepEqual(backward.junction, {
    ...original.junction,
    fromColumns: original.junction.toColumns,
    toColumns: original.junction.fromColumns,
  });
});

test("relation resolution rejects mismatched composite key widths", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              from: { columns: ["tenant_id", "author_id"], table: "posts" },
              id: "posts.author",
              name: "author",
              to: { columns: ["tenant_id"], table: "users" },
            },
          ],
        },
        name: "author",
        source: { kind: "table", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );
});

test("relation resolution rejects mismatched many-to-many junction widths", () => {
  const base = {
    cardinality: "many-to-many" as const,
    from: {
      columns: ["organization_id", "id"],
      table: "organizations",
    },
    id: "organizations.members",
    junction: {
      fromColumns: ["organization_id"],
      table: "organization_members",
      toColumns: ["member_id", "member_id"],
    },
    name: "members",
    to: { columns: ["id", "tenant_id"], table: "members" },
  };

  assert.throws(
    () =>
      resolveRelation({
        catalog: { entries: [base] },
        name: "members",
        source: { kind: "table", table: "organizations" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );

  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              ...base,
              junction: {
                ...base.junction,
                fromColumns: ["organization_id", "organization_id"],
                toColumns: ["member_id"],
              },
            },
          ],
        },
        name: "members",
        source: { kind: "table", table: "organizations" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );
});

test("relation resolution allows asymmetric many-to-many key widths", () => {
  const descriptor = resolveRelation({
    catalog: {
      entries: [
        {
          cardinality: "many-to-many",
          from: { columns: ["id"], table: "organizations" },
          id: "organizations.members",
          junction: {
            fromColumns: ["organization_id"],
            table: "organization_members",
            toColumns: ["tenant_id", "member_id"],
          },
          name: "members",
          to: { columns: ["tenant_id", "id"], table: "members" },
        },
      ],
    },
    name: "members",
    source: { kind: "table", table: "organizations" },
  });

  assert.equal(descriptor.cardinality, "many-to-many");
});

test("schema-qualified relation resolution does not match unscoped metadata", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              from: { columns: ["author_id"], table: "posts" },
              id: "posts.author",
              name: "author",
              to: { columns: ["id"], table: "users" },
            },
          ],
        },
        name: "author",
        source: { kind: "table", schema: "public", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNKNOWN_RELATION"
  );
});

test("unqualified source tables match uniquely schema-qualified relation metadata", () => {
  const descriptor = resolveRelation({
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          from: { columns: ["author_id"], schema: "billing", table: "posts" },
          id: "billing.posts.posts_author_id_fkey",
          name: "users",
          to: { columns: ["id"], schema: "billing", table: "users" },
        },
      ],
    },
    name: "users",
    source: { kind: "table", table: "posts" },
  });

  assert.equal(descriptor.id, "billing.posts.posts_author_id_fkey");
  assert.equal(descriptor.from.schema, "billing");
  assert.equal(descriptor.to.schema, "billing");
});

test("unqualified relation resolution remains ambiguous across schemas", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              from: { columns: ["author_id"], schema: "billing", table: "posts" },
              id: "billing.posts.posts_author_id_fkey",
              name: "users",
              to: { columns: ["id"], schema: "billing", table: "users" },
            },
            {
              cardinality: "many-to-one",
              from: { columns: ["author_id"], schema: "public", table: "posts" },
              id: "public.posts.posts_author_id_fkey",
              name: "users",
              to: { columns: ["id"], schema: "public", table: "users" },
            },
          ],
        },
        name: "users",
        source: { kind: "table", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_AMBIGUOUS_RELATION"
  );
});

test("constraint selectors do not match relation display names", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              from: { columns: ["author_id"], table: "posts" },
              id: "public.posts.posts_author_id_fkey",
              name: "users",
              to: { columns: ["id"], table: "users" },
            },
          ],
        },
        constraintHint: "users",
        name: "users",
        source: { kind: "table", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNKNOWN_RELATION"
  );
});

test("constraint selectors match only canonical constraint identity", () => {
  const descriptor = resolveRelation({
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          constraint: "posts_author_id_fkey",
          from: { columns: ["author_id"], table: "posts" },
          id: "public.posts.posts_author_id_fkey",
          name: "users",
          to: { columns: ["id"], table: "users" },
        },
      ],
    },
    constraintHint: "posts_author_id_fkey",
    name: "users",
    source: { kind: "table", table: "posts" },
  });

  assert.equal(descriptor.constraint, "posts_author_id_fkey");
});

test("raw provider constraint selectors translate to canonical identities", () => {
  const descriptor = resolveRelation({
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          constraint:
            "constraint:v1/postgres/public/posts/posts_author_id_fkey",
          constraintAliases: ["posts_author_id_fkey"],
          from: { columns: ["author_id"], schema: "public", table: "posts" },
          id: "relation:v1/postgres/public/posts/posts_author_id_fkey",
          name: "users",
          source: "provider-discovery",
          to: { columns: ["id"], schema: "public", table: "users" },
        },
      ],
    },
    constraintHint: "posts_author_id_fkey",
    name: "users",
    source: { kind: "table", schema: "public", table: "posts" },
  });

  assert.equal(
    descriptor.constraint,
    "constraint:v1/postgres/public/posts/posts_author_id_fkey"
  );
});

test("raw provider constraint selectors translate for reverse relation resolution", () => {
  const descriptor = resolveRelation({
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          constraint:
            "constraint:v1/postgres/public/posts/posts_author_id_fkey",
          constraintAliases: ["posts_author_id_fkey"],
          from: { columns: ["author_id"], schema: "public", table: "posts" },
          id: "relation:v1/postgres/public/posts/posts_author_id_fkey",
          name: "author",
          source: "provider-discovery",
          to: { columns: ["id"], schema: "public", table: "users" },
        },
      ],
    },
    constraintHint: "posts_author_id_fkey",
    name: "posts",
    source: { kind: "table", schema: "public", table: "users" },
    targetHint: { kind: "table", schema: "public", table: "posts" },
  });

  assert.equal(
    descriptor.constraint,
    "constraint:v1/postgres/public/posts/posts_author_id_fkey"
  );
  assert.equal(descriptor.cardinality, "one-to-many");
});

test("canonical identities reject empty required components", () => {
  assert.equal(
    canonicalIdentity("relation", "model", undefined, "posts", "author"),
    "relation:v1/model//posts/author"
  );
  for (const [owner, schema, table, key] of [
    ["", undefined, "posts", "author"],
    ["model", undefined, "", "author"],
    ["model", undefined, "posts", ""],
  ] as const) {
    assert.throws(
      () => canonicalIdentity("relation", owner, schema, table, key),
      (error: unknown) =>
        error instanceof AthenaQueryError &&
        error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
    );
  }
});

test("relation descriptor validation rejects invalid canonical identities and fields", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              constraint: "constraint:v1/model/public/posts/",
              from: { columns: ["author_id"], table: "posts" },
              id: "relation:v1/model/public/posts/author",
              name: "users",
              to: { columns: ["id"], table: "users" },
            },
          ],
        },
        name: "users",
        source: { kind: "table", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );

  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              from: { columns: [""], table: "posts" },
              id: "posts.author",
              name: "users",
              to: { columns: ["id"], table: "users" },
            },
          ],
        },
        name: "users",
        source: { kind: "table", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );
});

test("model and live provider aliases fail closed when identities collide", () => {
  const modelCatalog = catalogFromModelRelations({
    relations: {
      users: {
        constraintName: "posts_author_id_fkey",
        kind: "many-to-one",
        sourceColumns: ["author_id"],
        targetColumns: ["id"],
        targetModel: "users",
        targetSchema: "public",
      },
    },
    schema: "public",
    table: "posts",
  });
  const providerCatalog: AthenaRelationCatalog = {
    entries: [
      {
        cardinality: "many-to-one",
        constraint:
          "constraint:v1/postgres/public/posts/posts_author_id_fkey",
        constraintAliases: ["posts_author_id_fkey"],
        from: {
          columns: ["author_id"],
          schema: "public",
          table: "posts",
        },
        id: "relation:v1/postgres/public/posts/posts_author_id_fkey",
        name: "users",
        source: "provider-discovery",
        to: { columns: ["id"], schema: "public", table: "users" },
      },
    ],
  };
  const merged = mergeRelationCatalogs(modelCatalog, providerCatalog);

  assert.throws(
    () =>
      resolveRelation({
        catalog: merged,
        constraintHint: "posts_author_id_fkey",
        name: "users",
        source: { kind: "table", schema: "public", table: "posts" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_AMBIGUOUS_RELATION"
  );

  const model = modelCatalog.entries[0] as NonNullable<
    (typeof modelCatalog.entries)[number]
  >;
  const provider = providerCatalog.entries[0] as NonNullable<
    (typeof providerCatalog.entries)[number]
  >;
  assert.equal(
    resolveRelation({
      catalog: merged,
      constraintHint: model.constraint,
      name: "users",
      source: { kind: "table", schema: "public", table: "posts" },
    }).id,
    model.id
  );
  assert.equal(
    resolveRelation({
      catalog: merged,
      constraintHint: provider.constraint,
      name: "users",
      source: { kind: "table", schema: "public", table: "posts" },
    }).id,
    provider.id
  );
});

test("mergeRelationCatalogs rejects conflicting duplicate relation IDs", () => {
  assert.throws(
    () =>
      mergeRelationCatalogs(
        {
          entries: [
            {
              cardinality: "many-to-one",
              constraint: "posts_author_id_fkey",
              from: { columns: ["author_id"], table: "posts" },
              id: "public.posts.posts_author_id_fkey",
              name: "users",
              to: { columns: ["id"], table: "users" },
            },
          ],
        },
        {
          entries: [
            {
              cardinality: "many-to-one",
              constraint: "posts_editor_id_fkey",
              from: { columns: ["editor_id"], table: "posts" },
              id: "public.posts.posts_author_id_fkey",
              name: "users",
              to: { columns: ["id"], table: "users" },
            },
          ],
        }
      ),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );
});

test("mergeRelationCatalogs deduplicates semantically identical relation IDs", () => {
  const entry = {
    cardinality: "many-to-one" as const,
    constraint: "posts_author_id_fkey",
    from: { columns: ["author_id"], table: "posts" },
    id: "public.posts.posts_author_id_fkey",
    name: "users",
    to: { columns: ["id"], table: "users" },
  };
  const merged = mergeRelationCatalogs(
    { entries: [entry] },
    { entries: [{ ...entry, from: { ...entry.from }, to: { ...entry.to } }] }
  );
  assert.equal(merged.entries.length, 1);
});

test("relation resolution rejects zero-width non-junction mappings", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "one-to-one",
              from: { columns: [], table: "users" },
              id: "users.profile",
              name: "profile",
              to: { columns: [], table: "profiles" },
            },
          ],
        },
        name: "profile",
        source: { kind: "table", table: "users" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );
});

test("relation resolution rejects zero-width junction mappings", () => {
  assert.throws(
    () =>
      resolveRelation({
        catalog: {
          entries: [
            {
              cardinality: "many-to-many",
              from: { columns: ["id"], table: "users" },
              id: "users.roles",
              junction: {
                fromColumns: [],
                table: "user_roles",
                toColumns: ["role_id"],
              },
              name: "roles",
              to: { columns: ["id"], table: "roles" },
            },
          ],
        },
        name: "roles",
        source: { kind: "table", table: "users" },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_RELATION_METADATA_CONFLICT"
  );
});

test("explicit target schema prevents relation-name shortcut mismatch", () => {
  const ast = normalizeFindManyInput({
    select: {
      users: {
        schema: "public",
        select: { id: true },
      },
    },
    table: "billing.posts",
  });

  assert.throws(
    () =>
      resolveQueryPlan(ast, {
        catalog: {
          entries: [
            {
              cardinality: "many-to-one",
              from: {
                columns: ["author_id"],
                schema: "billing",
                table: "posts",
              },
              id: "billing.posts.posts_author_id_fkey",
              name: "users",
              to: { columns: ["id"], schema: "billing", table: "users" },
            },
          ],
        },
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_UNKNOWN_RELATION"
  );
});

test("public relation where input accepts explicit via selectors", () => {
  const where: AthenaWhere = {
    users: {
      some: {},
      via: "posts_author_id_fkey",
    },
  };
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "posts",
    where,
  });

  assert.equal(ast.filter?.kind, "relation");
  if (ast.filter?.kind === "relation") {
    assert.equal(ast.filter.via, "posts_author_id_fkey");
  }
});

test("select-list relation syntax preserves explicit foreign-key selectors", () => {
  const fields = parseSelectList(
    "users!posts_author_id_fkey(id)",
    { kind: "table", table: "posts" }
  );
  const relation = fields[0];
  assert.ok(relation && relation.kind === "relation");
  if (relation?.kind === "relation") {
    assert.equal(relation.relation, "users");
    assert.equal(relation.via, undefined);
    assert.equal(relation.constraintHint, "posts_author_id_fkey");
  }
});

test("select-list relation syntax preserves inner as a parent-filter modifier", () => {
  const fields = parseSelectList("users!inner(id)", {
    kind: "table",
    table: "posts",
  });
  const relation = fields[0];
  assert.ok(relation && relation.kind === "relation");
  if (relation?.kind === "relation") {
    assert.equal(relation.constraintHint, undefined);
    assert.equal(relation.join, "inner");
  }
});

test("object-form relation selection preserves relation name and legacy via token", () => {
  const ast = normalizeFindManyInput({
    select: {
      users: {
        select: { id: true },
        via: "sender_id",
      },
    },
    table: "posts",
  });
  const relation = ast.selection.fields.find((field) => field.kind === "relation");
  assert.ok(relation && relation.kind === "relation");
  if (relation?.kind === "relation") {
    assert.equal(relation.relation, "users");
    assert.equal(relation.via, "sender_id");
    assert.equal(relation.legacyVia, "sender_id");
    assert.equal(relation.constraintHint, undefined);
  }
});

test("object-form relation constraint selectors disambiguate relation planning", () => {
  const ast = normalizeFindManyInput({
    select: {
      users: {
        select: { id: true },
        constraint: "posts_editor_id_fkey",
      },
    },
    table: "posts",
  });
  const plan = resolveQueryPlan(ast, {
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          from: { columns: ["author_id"], table: "posts" },
          id: "public.posts.posts_author_id_fkey",
          name: "users",
          to: { columns: ["id"], table: "users" },
        },
        {
          cardinality: "many-to-one",
          constraint: "posts_editor_id_fkey",
          from: { columns: ["editor_id"], table: "posts" },
          id: "public.posts.posts_editor_id_fkey",
          name: "users",
          to: { columns: ["id"], table: "users" },
        },
      ],
    },
  });

  const relation = plan.selection.find((field) => field.kind === "relation");
  assert.ok(relation && relation.kind === "relation");
  assert.equal(relation.descriptor.id, "public.posts.posts_editor_id_fkey");
});

test("object-form relation selection rejects ambiguous via and constraint", () => {
  assert.throws(
    () =>
      normalizeFindManyInput({
        select: {
          users: {
            constraint: "posts_author_id_fkey",
            select: { id: true },
            via: "sender_id",
          },
        },
        table: "posts",
      }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_INVALID_SELECTION"
  );
});

test("semantic select-list constraints guide relation planning without using via", () => {
  const ast = {
    cardinality: "many" as const,
    kind: "select" as const,
    selection: {
      fields: parseSelectList("users!posts_author_id_fkey(id)", {
        kind: "table",
        table: "posts",
      }),
    },
    source: { kind: "table" as const, table: "posts" },
  };
  const plan = resolveQueryPlan(ast, {
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          constraint: "posts_author_id_fkey",
          from: { columns: ["author_id"], table: "posts" },
          id: "public.posts.posts_author_id_fkey",
          name: "users",
          to: { columns: ["id"], table: "users" },
        },
      ],
    },
  });

  const relation = plan.selection.find((field) => field.kind === "relation");
  assert.ok(relation && relation.kind === "relation");
  assert.equal(relation.descriptor.id, "public.posts.posts_author_id_fkey");
});

test("relation predicates preserve explicit foreign-key selectors through planning", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "posts",
    where: { users: { some: {} } },
  });
  if (ast.filter?.kind !== "relation") {
    assert.fail("expected a relation filter");
  }
  ast.filter.via = "posts_author_id_fkey";

  const plan = resolveQueryPlan(ast, {
    catalog: {
      entries: [
        {
          cardinality: "many-to-one",
          constraint: "posts_author_id_fkey",
          from: { columns: ["author_id"], table: "posts" },
          id: "public.posts.posts_author_id_fkey",
          name: "users",
          to: { columns: ["id"], table: "users" },
        },
      ],
    },
  });
  assert.equal(plan.filter?.kind, "resolved-relation");
  if (plan.filter?.kind === "resolved-relation") {
    assert.equal(plan.filter.descriptor.id, "public.posts.posts_author_id_fkey");
  }
});

test("relation predicate input preserves explicit foreign-key selectors", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "posts",
    where: {
      users: {
        some: {},
        via: "posts_author_id_fkey",
      },
    },
  });
  assert.equal(ast.filter?.kind, "relation");
  if (ast.filter?.kind !== "relation") {
    return;
  }
  assert.equal(ast.filter.relation, "users");
  assert.equal(ast.filter.via, "posts_author_id_fkey");
});

test("ambiguous relation predicates require an explicit selector", () => {
  const catalogWithTwoForeignKeys: AthenaRelationCatalog = {
    entries: [
      {
        cardinality: "many-to-one",
        constraint: "posts_author_id_fkey",
        from: { columns: ["author_id"], table: "posts" },
        id: "public.posts.posts_author_id_fkey",
        name: "users",
        to: { columns: ["id"], table: "users" },
      },
      {
        cardinality: "many-to-one",
        constraint: "posts_editor_id_fkey",
        from: { columns: ["editor_id"], table: "posts" },
        id: "public.posts.posts_editor_id_fkey",
        name: "users",
        to: { columns: ["id"], table: "users" },
      },
    ],
  };
  const ambiguous = normalizeFindManyInput({
    select: { id: true },
    table: "posts",
    where: { users: { some: {} } },
  });
  assert.throws(
    () => resolveQueryPlan(ambiguous, { catalog: catalogWithTwoForeignKeys }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      error.code === "ATHENA_QUERY_AMBIGUOUS_RELATION"
  );

  const selected = normalizeFindManyInput({
    select: { id: true },
    table: "posts",
    where: {
      users: {
        some: {},
        via: "posts_editor_id_fkey",
      },
    },
  });
  const plan = resolveQueryPlan(selected, {
    catalog: catalogWithTwoForeignKeys,
  });
  assert.equal(plan.filter?.kind, "resolved-relation");
  if (plan.filter?.kind === "resolved-relation") {
    assert.equal(plan.filter.descriptor.id, "public.posts.posts_editor_id_fkey");
  }
});

test("parent relation predicate is independent of nested selection filters", () => {
  const ast = normalizeFindManyInput({
    select: {
      posts: {
        select: { title: true },
        where: { published: true },
      },
    },
    table: "users",
    where: { posts: { some: { published: true } } },
  });
  const plan = resolveQueryPlan(ast, { catalog });
  assert.equal(plan.filter?.kind, "resolved-relation");
  const posts = plan.selection.find((field) => field.kind === "relation");
  assert.ok(posts && posts.kind === "relation");
  assert.equal(posts.plan.filter?.kind, "compare");
});

test("relation predicates consume the same nesting budget as selection", () => {
  const ast = normalizeFindManyInput({
    select: { id: true },
    table: "users",
    where: {
      posts: {
        some: {
          comments: { some: { approved: true } },
        },
      },
    },
  });
  assert.throws(
    () => validateQueryComplexity(ast, { maxNestedDepth: 1 }),
    (error: unknown) =>
      error instanceof AthenaQueryError &&
      (error.code === "ATHENA_QUERY_INVALID_NESTING" ||
        error.code === "ATHENA_QUERY_MAX_DEPTH_EXCEEDED")
  );
});
