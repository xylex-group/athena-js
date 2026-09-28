import {
  isDisabledAthenaAuthConfig,
  isLocalAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "../src/auth/config.ts";
import type { InsertOf, UpdateOf } from "../src/index.ts";
import {
  type AthenaClient,
  type AthenaClientConfig,
  type AthenaDataLifecycleEvent,
  type AthenaFindManyResult,
  type AthenaColumnBuilder,
  type AthenaLegacyNumberColumnBuilder,
  type AthenaRequestContext,
  bigint,
  createClient,
  decimal,
  defineModel,
  integer,
  number,
  string,
  table,
} from "../src/index.ts";
import { createAthenaBrowserClient } from "../src/next/client.ts";
import {
  createAthenaServerClient,
  resolveNextRequestContext,
} from "../src/next/server.ts";

declare module "../src/schema/table-columns.ts" {
  interface AthenaColumnBuilder<
    TValue,
    TNullable extends boolean = false,
    THasDefault extends boolean = false,
    TGenerated extends boolean = false,
    TColumnName extends string | undefined = undefined,
    TKind extends import("../src/schema/types.ts").ModelColumnKind =
      import("../src/schema/types.ts").ModelColumnKind,
    TIdentity extends
      import("../src/schema/types.ts").ModelColumnIdentity | undefined = undefined,
  > {
    readonly declarationMergeProbe?: "supported";
  }
}

const _declarationMergeProbe: AthenaColumnBuilder<string> = string();
void _declarationMergeProbe.declarationMergeProbe;

const userModel = defineModel<
  { id: string; email: string; created_at: string },
  { email: string },
  { email?: string }
>({
  meta: {
    nullable: { created_at: false, email: false, id: false },
    primaryKey: ["id"],
  },
});

const models = {
  app: {
    schemas: {
      public: {
        models: {
          users: userModel,
        },
      },
    },
  },
};

const context: AthenaRequestContext = {
  headers: { "X-Company-Id": "company_1" },
  organizationId: "org_1",
  userId: "user_1",
};

const disabledAuthOnly: AthenaClientConfig = {
  auth: false,
  chat: false,
  db: { pgUri: "postgres://example.invalid/app" },
};
type AthenaChatModeKeys = import("../src/v3-client-core.ts").AthenaChatMode;
const _chatModeIsAuthAligned: AthenaChatModeKeys = "local";
void _chatModeIsAuthAligned;
void ("remote" satisfies AthenaChatModeKeys);
// @ts-expect-error Chat disablement is chat:false, not mode:"disabled"
const _chatModeRejectsDisabled: AthenaChatModeKeys = "disabled";
void _chatModeRejectsDisabled;
// @ts-expect-error auth:false cannot carry url / mode fields
void disabledAuthOnly.auth.url;

// Classification helpers must accept createClient `auth` without requiring
// AthenaAuthConfig to be a Record<string, unknown> bag (DTS / tsup).
declare const createClientAuth: AthenaClientConfig["auth"];
void isDisabledAthenaAuthConfig(createClientAuth);
void isLocalAthenaAuthConfig(createClientAuth);
void normalizeAthenaAuthConfig(createClientAuth);

// Local Auth root (next-minimal): autoMigrate is a public createClient field.
const localAuthRoot: AthenaClientConfig = {
  auth: {
    autoMigrate: true,
    mode: "local",
  },
  databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena",
};
void createClient(localAuthRoot);

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? (<T>() => T extends Right ? 1 : 2) extends <T>() => T extends Left ? 1 : 2
      ? true
      : false
    : false;
type Expect<T extends true> = T;

type RelationTargetRow = { id: string; display_name: string };
type RelationSourceRow = {
  author_id: string;
  editor_id: string;
  id: string;
};

const relationTargetModel = defineModel<RelationTargetRow>({
  meta: {
    primaryKey: ["id"],
    tableName: "public.users",
  },
});

type RelationSourceMeta = {
  primaryKey: ["id"];
  relations: {
    posts_author_id_fkey_users: {
      kind: "many-to-one";
      sourceColumns: ["author_id"];
      targetColumns: ["id"];
      targetModel: "users";
      targetSchema: "public";
    };
    posts_editor_id_fkey_users: {
      kind: "many-to-one";
      sourceColumns: ["editor_id"];
      targetColumns: ["id"];
      targetModel: "users";
      targetSchema: "public";
    };
  };
  tableName: "public.posts";
};

const relationSourceModel = defineModel<
  RelationSourceRow,
  Partial<RelationSourceRow>,
  Partial<RelationSourceRow>,
  RelationSourceMeta
>({
  meta: {
    primaryKey: ["id"],
    relations: {
      posts_author_id_fkey_users: {
        kind: "many-to-one",
        sourceColumns: ["author_id"],
        targetColumns: ["id"],
        targetModel: "users",
        targetSchema: "public",
      },
      posts_editor_id_fkey_users: {
        kind: "many-to-one",
        sourceColumns: ["editor_id"],
        targetColumns: ["id"],
        targetModel: "users",
        targetSchema: "public",
      },
    },
    tableName: "public.posts",
  },
});

const relationRegistry = {
  app: {
    schemas: {
      public: {
        models: {
          posts: relationSourceModel,
          users: relationTargetModel,
        },
      },
    },
  },
};

type RelationSourceContext = {
  database: "app";
  model: typeof relationSourceModel;
  registry: typeof relationRegistry;
  schema: "public";
};

type RelationSourceKeys = keyof NonNullable<
  (typeof relationSourceModel)["meta"]["relations"]
>;
const _relationKeysAreSpecific: Expect<
  Equal<
    RelationSourceKeys,
    "posts_author_id_fkey_users" | "posts_editor_id_fkey_users"
  >
> = true;
void _relationKeysAreSpecific;

type SelectedConstraint = AthenaFindManyResult<
  RelationSourceRow,
  {
    users: {
      select: { id: true };
      constraint: "posts_author_id_fkey";
    };
  },
  RelationSourceContext
>;

type SelectedViaSourceColumn = AthenaFindManyResult<
  RelationSourceRow,
  {
    users: {
      select: { id: true };
      via: "author_id";
    };
  },
  RelationSourceContext
>;

const _typedViaConstraintResolvesTarget: Expect<
  Equal<SelectedConstraint["users"], { id: string } | null>
> = true;
void _typedViaConstraintResolvesTarget;
const _legacyTypedViaResolvesTarget: Expect<
  Equal<SelectedViaSourceColumn["users"], { id: string } | null>
> = true;
void _legacyTypedViaResolvesTarget;

void createClient({
  databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena",
  lifecycle: {
    data: {
      afterInsert(event) {
        const _eventIsNotAny: IsAny<typeof event> = false;
        const _asLifecycleEvent: AthenaDataLifecycleEvent = event;
        void _eventIsNotAny;
        void _asLifecycleEvent;
        void event.record;
        void event.records;
        void event.schema;
        void event.table;
      },
    },
  },
});
type AthenaAuthConfigKeys =
  keyof import("../src/v3-client-core.ts").AthenaAuthConfig;
void ("autoMigrate" satisfies AthenaAuthConfigKeys);

type AuthConfigOwnsEmail =
  "email" extends keyof import("../src/v3-client-core.ts").AthenaAuthConfig
    ? true
    : false;
const _authMustNotOwnEmailTransport: AuthConfigOwnsEmail = false;
void _authMustNotOwnEmailTransport;

const _authConfigRejectsNestedProvider: import("../src/v3-client-core.ts").AthenaAuthConfig =
  {
    // @ts-expect-error Auth must not own email.provider
    email: { provider: { id: "stolen" } },
    mode: "local",
  };
void _authConfigRejectsNestedProvider;

const emailRootConfig: AthenaClientConfig = {
  auth: { mode: "local" },
  databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena",
  email: {
    defaults: {
      from: "no-reply@example.com",
      fromName: "Athena",
      locale: "en",
      replyTo: "support@example.com",
    },
    provider: {
      id: "test",
      send: async () => ({
        accepted: ["user@example.com"],
        provider: "test",
        rejected: [],
        success: true,
      }),
    },
  },
};
void emailRootConfig.email?.provider;

const config: AthenaClientConfig<typeof models> = {
  auth: { credentials: "include" },
  chat: { wsUrl: "wss://athena.example.com/wss/gateway" },
  context: async () => context,
  db: { pgUri: "postgres://example.invalid/app" },
  debugAst: true,
  findManyAst: true,
  key: "test-key",
  models,
  retryReads: true,
  storage: {},
  traceQueries: true,
  url: "https://athena.example.com",
};

// Avoid direct AthenaClient<typeof models> assignment at the createClient call:
// nested model registries overflow TS instantiation depth (TS2589). Cast after
// the call so the rest of this file still exercises the public surface.
const client = createClient(
  config as unknown as AthenaClientConfig
) as unknown as AthenaClient<typeof models>;
const scoped = client.withContext(context) as unknown as AthenaClient<
  typeof models
>;

// Storage-enabled clients expose both presigned URL and binary proxy reads.
void client.storage.getStorageFileUrl("file_1", { purpose: "download" });
void client.storage.getStorageFileProxy("file_1", { purpose: "stream" });
// file facade mirrors the proxy route without replacing getStorageFileUrl.
void client.storage.file.proxy("file_1", { purpose: "read" });

void client.email.configured;
void client.email.diagnostics;
void client.email.send({
  subject: "Hello",
  text: "Hi",
  to: "user@example.com",
});

void scoped.from(userModel).select("id,email");
void scoped.from("users").select("id,email");
// @ts-expect-error known models reject unknown columns
void scoped.from("users").select("missing_column");
// findMany object-select uses the same model column typechecking
void scoped.from("users").findMany({
  limit: 1,
  select: {
    created_at: true,
    email: true,
    id: true,
  },
});

type UserRow = { id: string; email: string; created_at: string };
type UserIdEmail = Pick<UserRow, "id" | "email">;
type UserId = Pick<UserRow, "id">;

const usersAllColumns = scoped.from("users").select("*");
const _allColumns: Expect<
  Equal<Awaited<typeof usersAllColumns>["data"], UserRow[] | null>
> = true;
void _allColumns;

const usersTupleColumns = scoped.from("users").select(["id", "email"] as const);
const _tupleColumns: Expect<
  Equal<Awaited<typeof usersTupleColumns>["data"], UserIdEmail[] | null>
> = true;
void _tupleColumns;

const usersCommaColumns = scoped.from("users").select("id,email");
const _commaColumns: Expect<
  Equal<Awaited<typeof usersCommaColumns>["data"], UserIdEmail[] | null>
> = true;
void _commaColumns;

const usersAliasColumns = scoped.from("users").select("id as user_id");
const _aliasColumnsOpaque: Expect<
  Equal<
    Awaited<typeof usersAliasColumns>["data"],
    Record<string, unknown>[] | null
  >
> = true;
void _aliasColumnsOpaque;

const usersRelationColumns = scoped
  .from("users")
  .select("id,profile(*)");
const _relationColumnsOpaque: Expect<
  Equal<
    Awaited<typeof usersRelationColumns>["data"],
    Record<string, unknown>[] | null
  >
> = true;
void _relationColumnsOpaque;

const usersExpressionColumns = scoped.from("users").select("count(id)");
const _expressionColumnsOpaque: Expect<
  Equal<
    Awaited<typeof usersExpressionColumns>["data"],
    Record<string, unknown>[] | null
  >
> = true;
void _expressionColumnsOpaque;

const usersDynamicColumns: string = "id,email";
const usersDynamicSelection = scoped.from("users").select(usersDynamicColumns);
const _dynamicColumnsOpaque: Expect<
  Equal<
    Awaited<typeof usersDynamicSelection>["data"],
    Record<string, unknown>[] | null
  >
> = true;
void _dynamicColumnsOpaque;

const identityTable = table("identity_rows")
  .columns({
    always_id: integer().identity("always"),
    default_id: bigint().identity("by-default"),
    name: string(),
  })
  .primaryKey("always_id");
type IdentityInsert = InsertOf<typeof identityTable>;
type IdentityUpdate = UpdateOf<typeof identityTable>;
const _identityInsert: IdentityInsert = { name: "Ada" };
const _identityUpdate: IdentityUpdate = { default_id: "2" };
void _identityInsert;
void _identityUpdate;
// @ts-expect-error generated columns cannot transition to identity columns.
integer().generated().identity("always");
// @ts-expect-error identity columns cannot transition back to nullable columns.
integer().identity("always").optional();
// @ts-expect-error nullable columns cannot transition to identity columns.
integer().optional().identity("always");
// @ts-expect-error identity columns cannot transition to generated columns.
integer().identity("always").generated();
// @ts-expect-error PostgreSQL ALWAYS identity values are database-generated.
const _alwaysIdentityInsert: IdentityInsert = { always_id: 1 };
// @ts-expect-error PostgreSQL ALWAYS identity values are database-generated.
const _alwaysIdentityUpdate: IdentityUpdate = { always_id: 1 };
void _alwaysIdentityInsert;
void _alwaysIdentityUpdate;

const _legacyNumberIdentity = number().identity("always");
const _legacyNumberBuilder: AthenaLegacyNumberColumnBuilder = number();
void _legacyNumberIdentity;
void _legacyNumberBuilder;
// @ts-expect-error Identity is unavailable on string builders.
string().identity("always");
// @ts-expect-error Identity is unavailable on JSON builders.
json().identity("always");
// @ts-expect-error Identity is unavailable on decimal builders.
decimal().identity("always");
// @ts-expect-error Precision is only supported by decimal/numeric builders.
integer().precision(20);
// @ts-expect-error Scale is only supported by decimal/numeric builders.
bigint().scale(2);
const _decimalModifiers = decimal().precision(20).scale(4);
void _decimalModifiers;

const usersSingleId = scoped.from("users").single("id");
const _singleProjection: Expect<
  Equal<Awaited<typeof usersSingleId>["data"], UserId | null>
> = true;
void _singleProjection;

const usersMaybeSingleEmail = scoped.from("users").maybeSingle("email");
const _maybeSingleProjection: Expect<
  Equal<
    Awaited<typeof usersMaybeSingleEmail>["data"],
    Pick<UserRow, "email"> | null
  >
> = true;
void _maybeSingleProjection;

const insertedUserId = scoped
  .from("users")
  .insert({ email: "new@example.com" })
  .select("id");
const _insertProjection: Expect<
  Equal<Awaited<typeof insertedUserId>["data"], UserId | null>
> = true;
void _insertProjection;

const updatedUserId = scoped
  .from("users")
  .update({ email: "updated@example.com" })
  .eq("id", "user_1")
  .returning("id");
const _updateProjection: Expect<
  Equal<Awaited<typeof updatedUserId>["data"], UserId[] | null>
> = true;
void _updateProjection;

const updatedUserSingleId = scoped
  .from("users")
  .update({ email: "updated@example.com" })
  .eq("id", "user_1")
  .single("id");
const _updateSingleProjection: Expect<
  Equal<Awaited<typeof updatedUserSingleId>["data"], UserId | null>
> = true;
void _updateSingleProjection;
void scoped.from(userModel).findMany({
  select: {
    email: true,
    id: true,
  },
});
void scoped.from("users").findMany({
  select: {
    // @ts-expect-error known models reject unknown findMany select keys
    missing_column: true,
  },
});

const dynamic = createClient({
  key: "test-key",
  url: "https://athena.example.com",
});
void dynamic
  .from<{ runtime_column: string }>("runtime_table")
  .select("runtime_column");
void dynamic.from<{ runtime_column: string }>("runtime_table").findMany({
  select: {
    runtime_column: true,
  },
});
// free-form tables remain untyped for findMany select keys
void dynamic.from("runtime_table").findMany({
  select: {
    any_column: true,
  },
});
void resolveNextRequestContext({
  requestHeaders: { cookie: "athena-auth.session-token=test" },
});

const browserClient = createAthenaBrowserClient({
  key: "publishable_key",
  models,
  url: "https://athena.example.com",
});
void browserClient.from("users").select("id,email");
// @ts-expect-error known models reject unknown columns on browser factory clients
void browserClient.from("users").select("missing_column");
void browserClient.from("users").findMany({
  select: {
    email: true,
    id: true,
  },
});
void browserClient.from("users").findMany({
  select: {
    // @ts-expect-error known models reject unknown findMany select keys on browser factory
    missing_column: true,
  },
});
createAthenaBrowserClient({
  // @ts-expect-error browser factory config omits env
  env: process.env,
  key: "publishable_key",
  url: "https://athena.example.com",
});
createAthenaBrowserClient({
  // @ts-expect-error browser factory config omits request context
  context: { userId: "x" },
  key: "publishable_key",
  url: "https://athena.example.com",
});

// Layered { client } boundary must stay shallow: a strongly typed root's
// withContext return (narrow table unions) must assign without comparing the
// full AthenaClient database surface (otherwise TS2589 / assignability errors).
declare const typedLayeredRoot: {
  withContext: (context: AthenaRequestContext) => {
    from: (table: "users") => { select: (cols: string) => Promise<unknown> };
  };
};
void (async () => {
  const layered = await createAthenaServerClient({
    client: typedLayeredRoot,
    requestCookies: "",
    requestHeaders: {},
  });
  void layered;
})();

const serverClient = await createAthenaServerClient({
  env: process.env,
  models,
  requestCookies: "",
  requestHeaders: {},
});
void serverClient.from("users").select("id,email");
// @ts-expect-error known models reject unknown columns on server factory clients
void serverClient.from("users").select("missing_column");
void serverClient.from("users").findMany({
  select: {
    created_at: true,
    email: true,
    id: true,
  },
});
void serverClient.from("users").findMany({
  select: {
    // @ts-expect-error known models reject unknown findMany select keys on server factory
    missing_column: true,
  },
});
// @ts-expect-error server factory requires url+key, env, databaseUrl, or client
void createAthenaServerClient({});
void createAthenaServerClient({
  databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena",
});

const usersTable = table("users")
  .schema("public")
  .columns({
    email: string(),
    id: string(),
  })
  .primaryKey("id");

void scoped.from(usersTable).select("id,email");
void browserClient.from(usersTable).select("id,email");
void serverClient.from(usersTable).select("id,email");
// @ts-expect-error table targets reject unknown columns
void scoped.from(usersTable).select("missing_column");

// @ts-expect-error positional construction was removed in v3
createClient("https://athena.example.com", "test-key");
// Removed v3 config keys must not appear on AthenaClientConfig
type AthenaClientConfigKeys =
  keyof import("../src/v3-client.ts").AthenaClientConfig;
// @ts-expect-error the v3 config has no experimental bag
void ("experimental" satisfies AthenaClientConfigKeys);
// @ts-expect-error typecheckColumns was removed
void ("typecheckColumns" satisfies AthenaClientConfigKeys);
// @ts-expect-error flat service aliases were removed
createClient({ gatewayUrl: "https://athena.example.com/db", key: "test-key" });

// billing namespace is always present on the public client type surface
void client.billing.getCapabilities;

// Execution mode is a closed alias union (`AthenaExecutionMode | string` collapsed to string).
void createClient({
  key: "test-key",
  mode: "auto",
  url: "https://athena.example.com",
});
void createClient({
  d1: { prepare() {} } as never,
  mode: "d1",
});
// @ts-expect-error empty execution mode is not a valid AthenaExecutionModeInput
createClient({ mode: "" });
// @ts-expect-error unknown execution mode is not a valid AthenaExecutionModeInput
createClient({ mode: "postgres" });
createClient({
  key: "test-key",
  // @ts-expect-error empty prefer is not a valid AthenaExecutionPreferInput
  prefer: "",
  url: "https://athena.example.com",
});
