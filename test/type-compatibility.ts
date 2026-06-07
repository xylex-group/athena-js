import {
  createTypedClient,
  createClient,
  AthenaClient,
  createModelFormAdapter,
  defineGeneratorConfig,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
  normalizeAthenaGatewayBaseUrl,
  isOk,
  requireAffected,
  requireSuccess,
  toModelFormDefaults,
  toModelPayload,
  unwrap,
  unwrapOne,
  unwrapRows,
  verifyAthenaGatewayUrl,
  type RequireAffectedOptions,
  type AthenaResult,
  type AthenaGatewayConnectionResult,
  type ModelFormDefaults,
  type ModelFormValues,
} from "../src/index.ts"
import type {
  AthenaStateAdapter,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "../src/react/index.ts"

interface UserRow {
  id: string
  name: string
  email?: string | null
}

declare function acceptsUserPromise(value: Promise<AthenaResult<UserRow>>): void
declare function acceptsUserArrayPromise(value: Promise<AthenaResult<UserRow[]>>): void
declare function acceptsUserArrayPromiseLike(value: PromiseLike<AthenaResult<UserRow[]>>): void
declare function acceptsUserArrayWithCountPromise(
  value: Promise<AthenaResult<UserRow[]>>,
): void
declare function acceptsCountValue(value: number | null | undefined): void

declare function acceptsMaybeUserPromise(value: Promise<AthenaResult<UserRow | null>>): void
declare function acceptsMaybeUserPickPromise(
  value: Promise<AthenaResult<Pick<UserRow, "id"> | null>>,
): void
declare function acceptsUserRow(value: UserRow): void
declare function acceptsUserRows(value: UserRow[]): void
declare function acceptsNullableUserRow(value: UserRow | null): void
declare function acceptsNumber(value: number): void
declare function acceptsString(value: string): void
declare function acceptsUnknown(value: unknown): void
declare function acceptsGatewayConnectionPromise(
  value: Promise<AthenaGatewayConnectionResult>,
): void

declare function acceptsUserInsertMutation(
  value: PromiseLike<AthenaResult<UserRow>>,
): void
declare function acceptsUserArrayInsertMutation(
  value: PromiseLike<AthenaResult<UserRow[]>>,
): void

const client = createClient("https://mirror3.athena-db.com", "api-key")
const fluentBuilderClient = AthenaClient.builder()
  .url("https://mirror3.athena-db.com")
  .key("api-key")
  .auth({ baseUrl: "https://auth.example.com/api/auth" })
  .experimental({ traceQueries: true })
  .options({
    client: "typed-client",
    headers: { "X-App-Source": "type-test" },
  })
  .build()
const createClientDropIn: typeof fluentBuilderClient = createClient(
  'https://mirror3.athena-db.com',
  'api-key',
  {
    auth: { baseUrl: 'https://auth.example.com/api/auth' },
  },
)
const builderDropIn: ReturnType<typeof createClient> = fluentBuilderClient
const experimentalClient = createClient("https://mirror3.athena-db.com", "api-key", {
  experimental: {
    enableErrorNormalization: true,
    findManyAst: true,
    retryReads: true,
    traceQueries: {
      logger: event => {
        acceptsString(event.operation)
        acceptsString(event.sql)
      },
    },
  },
})
const normalizedGatewayUrl = normalizeAthenaGatewayBaseUrl('https://mirror3.athena-db.com/')
acceptsString(normalizedGatewayUrl)
acceptsGatewayConnectionPromise(client.verifyConnection())
acceptsGatewayConnectionPromise(verifyAthenaGatewayUrl('https://mirror3.athena-db.com'))
const authSessionResult = client.auth.getSession()
const builderAuthSessionResult = fluentBuilderClient.auth.getSession()
authSessionResult.then(result => {
  if (result.ok) {
    const sessionId = result.data?.session.id
    if (sessionId) acceptsString(sessionId)
  }
})
builderAuthSessionResult.then(result => {
  if (result.ok) {
    const sessionId = result.data?.session.id
    if (sessionId) acceptsString(sessionId)
  }
})
const users = client.from<UserRow>("users")
const usersInAuth = client.from<UserRow>("users", { schema: "auth" })
const dbUsers = client.db.from<UserRow>('users')
const dbUsersInAuth = client.db.from<UserRow>('users', { schema: 'auth' })

users.eq('id', '1')
users.order('name')
users.select('id').eq('name', 'Alice')
usersInAuth.select('id')
dbUsers.eq('id', '1')
dbUsers.select('id').eq('name', 'Alice')
dbUsersInAuth.select('id')

// @ts-expect-error unknown filter column should be rejected
users.eq('missing_column', 'x')

acceptsUserPromise(users.insert({ id: "1", name: "Alice" }).select())
acceptsUserArrayPromise(users.insert([{ id: "1", name: "Alice" }]).select())

acceptsUserPromise(
  users.upsert({ id: "1", name: "Alice" }, { onConflict: "id" }).select(),
)
acceptsUserArrayPromise(
  users.upsert([{ id: "1", name: "Alice" }], { onConflict: "id" }).select(),
)

acceptsUserInsertMutation(users.insert({ id: "1", name: "Alice" }))
acceptsUserArrayInsertMutation(users.insert([{ id: "1", name: "Alice" }]))

const idOnlySelect = users.select<Pick<UserRow, "id">>("id")
acceptsUserPickArrayPromise(idOnlySelect)
acceptsMaybeUserPickPromise(idOnlySelect.single())
acceptsMaybeUserPickPromise(idOnlySelect.maybeSingle())

declare function acceptsUserFindManyBasePromise(
  value: Promise<
    AthenaResult<
      Array<{
        id: string
        name: string
      }>
    >
  >,
): void

acceptsUserFindManyBasePromise(
  users.findMany({
    select: {
      id: true,
      name: true,
    },
  }),
)

users
  .findMany({
    select: {
      id: true,
      profile: {
        select: {
          id: true,
        },
      },
    },
  })
  .then(result => {
    if (result.data && result.data.length > 0) {
      acceptsString(result.data[0].id)
      acceptsUnknown(result.data[0].profile)
    }
  })

users.findMany({
  select: {
    id: true,
    user: {
      schema: 'athena',
      select: {
        id: true,
      },
    },
  },
})

users.findMany({
  select: {
    id: true,
    // @ts-expect-error relation nodes do not support explicit `on` clauses
    users: {
      schema: 'athena',
      select: {
        id: true,
      },
      on: {
        id: {
          $eq: {
            $parent: 'user_id',
          },
        },
      },
    },
  },
})

users.findMany({
  select: {
    id: true,
    // @ts-expect-error relation nodes cannot combine schema and via
    users: {
      schema: 'athena',
      via: 'user_id',
      select: {
        id: true,
      },
    },
  },
})

acceptsMaybeUserPromise(users.single())
acceptsMaybeUserPromise(users.maybeSingle())

const listUsersRpc = client.rpc<UserRow>('list_users', { active_only: true })
acceptsUserArrayPromise(listUsersRpc.select())
acceptsMaybeUserPromise(listUsersRpc.single())
acceptsMaybeUserPromise(listUsersRpc.maybeSingle())
acceptsUserArrayWithCountPromise(client.rpc<UserRow>('list_users', {}, { count: 'exact' }).select())
acceptsUserArrayWithCountPromise(client.rpc<UserRow>('list_users', {}, { count: 'planned' }).select())
acceptsUserArrayWithCountPromise(client.rpc<UserRow>('list_users', {}, { count: 'estimated' }).select())
acceptsUserArrayWithCountPromise(client.rpc<UserRow>('list_users', {}, { get: true }).select())
acceptsUserArrayWithCountPromise(client.rpc<UserRow>('list_users', {}, { head: true }).select())
client.rpc<UserRow>('list_users').select().then(result => acceptsCountValue(result.count))
acceptsUserArrayPromise(client.rpc<UserRow>('list_users').order('created_at').range(0, 24).select())
acceptsMaybeUserPromise(client.rpc<UserRow>('list_users').order('created_at', { ascending: false }).single())
acceptsUserPromise(experimentalClient.from<UserRow>('users').insert({ id: "3", name: "Ciri" }).select())
acceptsUserArrayPromiseLike(fluentBuilderClient.from<UserRow>('users').select())
acceptsUserArrayPromiseLike(client.db.select<UserRow>('users'))
acceptsMaybeUserPromise(client.db.select<UserRow>('users').single())
acceptsUserPromise(client.db.insert<UserRow>('users', { id: "4", name: "Geralt" }).select())
acceptsUserArrayPromise(client.db.insert<UserRow>('users', [{ id: "5", name: "Yennefer" }]).select())
acceptsUserArrayPromise(client.db.rpc<UserRow>('list_users').select())
acceptsUserArrayPromise(client.db.query<UserRow>('select id, name from users'))

const helperResult = users.select()
helperResult.then(result => {
  if (isOk(result)) {
    const successful = requireSuccess(result)
    acceptsUserRows(unwrapRows(successful))
  }
})

users.single().then(result => {
  acceptsUserRow(unwrapOne(result))
  acceptsNullableUserRow(unwrapOne(result, { allowNull: true }))
  acceptsNullableUserRow(unwrap(result, { allowNull: true }))
})

const countedResult: AthenaResult<UserRow[]> = {
  data: [{ id: '1', name: 'Alice' }],
  error: null,
  status: 200,
  count: 1,
  raw: null,
}
acceptsNumber(requireAffected(countedResult))

const affectedOptions: RequireAffectedOptions = { min: 2 }
acceptsNumber(requireAffected(countedResult, affectedOptions))

// @ts-expect-error insert(one) should not be inferred as array result
acceptsUserArrayPromise(users.insert({ id: "1", name: "Alice" }).select())

// @ts-expect-error insert(many) should not be inferred as single-row result
acceptsUserPromise(users.insert([{ id: "1", name: "Alice" }]).select())

// @ts-expect-error upsert(one) should not be inferred as array result
acceptsUserArrayPromise(users.upsert({ id: "1", name: "Alice" }, { onConflict: "id" }).select())

// @ts-expect-error upsert(many) should not be inferred as single-row result
acceptsUserPromise(users.upsert([{ id: "1", name: "Alice" }], { onConflict: "id" }).select())

// @ts-expect-error rpc in() requires an array value
client.rpc<UserRow>('list_users').in('id', 'not-an-array')

declare function acceptsUserPickArrayPromise(
  value: PromiseLike<AthenaResult<Array<Pick<UserRow, "id">>>>,
): void

declare function acceptsUserQueryHookResult(value: UseQueryResult<UserRow[]>): void
declare function acceptsUserMutationHookResult(
  value: UseMutationResult<{ name: string }, UserRow>,
): void
declare function acceptsUserQueryOptions(
  value: UseQueryOptions<AthenaResult<UserRow[]>, UserRow[]>,
): void
declare function acceptsUserMutationOptions(
  value: UseMutationOptions<{ name: string }, AthenaResult<UserRow>, UserRow>,
): void
declare function acceptsAthenaStateAdapter(value: AthenaStateAdapter): void
declare function acceptsCreateClientCompatible(value: ReturnType<typeof createClient>): void
declare function acceptsBuilderCompatible(value: typeof fluentBuilderClient): void

const queryHookResult = {} as UseQueryResult<UserRow[]>
acceptsUserQueryHookResult(queryHookResult)
acceptsCreateClientCompatible(fluentBuilderClient)
acceptsBuilderCompatible(createClientDropIn)
acceptsCreateClientCompatible(builderDropIn)

const mutationHookResult = {} as UseMutationResult<{ name: string }, UserRow>
acceptsUserMutationHookResult(mutationHookResult)

const queryOptions: UseQueryOptions<AthenaResult<UserRow[]>, UserRow[]> = {
  queryKey: ["users"],
  queryFn: async () => ({
    data: [{ id: "1", name: "Alice" }],
    error: null,
    status: 200,
    raw: null,
  }),
  select: payload => payload.data ?? [],
}
acceptsUserQueryOptions(queryOptions)

const mutationOptions: UseMutationOptions<{ name: string }, AthenaResult<UserRow>, UserRow> = {
  mutationFn: async variables => ({
    data: { id: "2", name: variables.name },
    error: null,
    status: 201,
    raw: null,
  }),
  select: payload => payload.data ?? { id: "fallback", name: "fallback" },
}
acceptsUserMutationOptions(mutationOptions)

const stateAdapter: AthenaStateAdapter = {
  onEvent: () => undefined,
  onQueryUpdated: () => undefined,
  onMutationUpdated: () => undefined,
}
acceptsAthenaStateAdapter(stateAdapter)

interface OrganizationRow {
  id: string
  slug: string
  owner_user_id: string
}

interface ProfileRow {
  id: string
  user_id: string
  display_name: string | null
}

interface ProjectRow {
  id: string
  user_id: string
  title: string
}

interface TagRow {
  id: string
  label: string
}

const typedRegistry = defineRegistry({
  primary: defineDatabase({
    public: defineSchema({
      users: defineModel<
        UserRow,
        Pick<UserRow, 'name'> & Partial<Pick<UserRow, 'email'>>,
        Partial<Pick<UserRow, 'name' | 'email'>>
      >({
        meta: {
          database: 'primary',
          schema: 'public',
          model: 'users',
          primaryKey: ['id'],
          nullable: {
            id: false,
            name: false,
            email: true,
          },
          relations: {
            profile: {
              kind: 'one-to-one',
              sourceColumns: ['id'],
              targetSchema: 'public',
              targetModel: 'profiles',
              targetColumns: ['user_id'],
            },
            projects: {
              kind: 'one-to-many',
              sourceColumns: ['id'],
              targetSchema: 'public',
              targetModel: 'projects',
              targetColumns: ['user_id'],
            },
          },
        },
      }),
      organizations: defineModel<
        OrganizationRow,
        Pick<OrganizationRow, 'slug' | 'owner_user_id'>,
        Partial<Pick<OrganizationRow, 'slug' | 'owner_user_id'>>
      >({
        meta: {
          database: 'primary',
          schema: 'public',
          model: 'organizations',
          primaryKey: ['id'],
          nullable: {
            id: false,
            slug: false,
            owner_user_id: false,
          },
          relations: {
            owner: {
              kind: 'many-to-one',
              sourceColumns: ['owner_user_id'],
              targetSchema: 'public',
              targetModel: 'users',
              targetColumns: ['id'],
            },
          },
        },
      }),
      profiles: defineModel<
        ProfileRow,
        Pick<ProfileRow, 'user_id' | 'display_name'>,
        Partial<Pick<ProfileRow, 'display_name'>>
      >({
        meta: {
          database: 'primary',
          schema: 'public',
          model: 'profiles',
          primaryKey: ['id'],
          nullable: {
            id: false,
            user_id: false,
            display_name: true,
          },
          relations: {
            user: {
              kind: 'many-to-one',
              sourceColumns: ['user_id'],
              targetSchema: 'public',
              targetModel: 'users',
              targetColumns: ['id'],
            },
          },
        },
      }),
      projects: defineModel<
        ProjectRow,
        Pick<ProjectRow, 'user_id' | 'title'>,
        Partial<Pick<ProjectRow, 'title'>>
      >({
        meta: {
          database: 'primary',
          schema: 'public',
          model: 'projects',
          primaryKey: ['id'],
          nullable: {
            id: false,
            user_id: false,
            title: false,
          },
          relations: {
            tags: {
              kind: 'many-to-many',
              sourceColumns: ['id'],
              targetSchema: 'public',
              targetModel: 'tags',
              targetColumns: ['id'],
              through: {
                schema: 'public',
                model: 'project_tags',
                sourceColumns: ['project_id'],
                targetColumns: ['tag_id'],
              },
            },
          },
        },
      }),
      tags: defineModel<TagRow, Pick<TagRow, 'label'>, Partial<Pick<TagRow, 'label'>>>({
        meta: {
          database: 'primary',
          schema: 'public',
          model: 'tags',
          primaryKey: ['id'],
          nullable: {
            id: false,
            label: false,
          },
          relations: {
            projects: {
              kind: 'many-to-many',
              sourceColumns: ['id'],
              targetSchema: 'public',
              targetModel: 'projects',
              targetColumns: ['id'],
              through: {
                schema: 'public',
                model: 'project_tags',
                sourceColumns: ['tag_id'],
                targetColumns: ['project_id'],
              },
            },
          },
        },
      }),
    }),
  }),
})

const typedClient = createTypedClient(typedRegistry, 'https://athena-db.com', 'api-key', {
  tenantKeyMap: {
    organizationId: 'X-Organization-Id',
  },
})

typedClient
  .withTenantContext({ organizationId: 'org_1' })
  .fromModel('primary', 'public', 'organizations')
  .select()
  .then(result => {
    if (result.data && result.data.length > 0) {
      acceptsString(result.data[0].slug)
    }
  })

typedClient
  .fromModel('primary', 'public', 'organizations')
  .insert({ slug: 'org-slug', owner_user_id: 'user_1' })
  .select()

typedClient
  .fromModel('primary', 'public', 'organizations')
  .update({ owner_user_id: 'user_2' })
  .eq('slug', 'org-slug')
  .select('id,slug')

declare function acceptsOrganizationFindManyPromise(
  value: Promise<
    AthenaResult<
      Array<{
        slug: string
        owner: {
          id: string
          name: string
        } | null
      }>
    >
  >,
): void

declare function acceptsOrganizationAliasFindManyPromise(
  value: Promise<
    AthenaResult<
      Array<{
        primary_owner: {
          id: string
        } | null
      }>
    >
  >,
): void

declare function acceptsUserFindManyPromise(
  value: Promise<
    AthenaResult<
      Array<{
        name: string
        profile: {
          display_name: string | null
        } | null
        projects: Array<{
          id: string
        }>
      }>
    >
  >,
): void

declare function acceptsProjectFindManyPromise(
  value: Promise<
    AthenaResult<
      Array<{
        title: string
        tags: Array<{
          label: string
        }>
      }>
    >
  >,
): void

acceptsOrganizationFindManyPromise(
  typedClient.fromModel('primary', 'public', 'organizations').findMany({
    select: {
      slug: true,
      owner: {
        via: 'owner_user_id',
        select: {
          id: true,
          name: true,
        },
      },
    },
  }),
)

acceptsOrganizationAliasFindManyPromise(
  typedClient.fromModel('primary', 'public', 'organizations').findMany({
    select: {
      owner: {
        as: 'primary_owner',
        via: 'owner_user_id',
        select: {
          id: true,
        },
      },
    },
  }),
)

acceptsUserFindManyPromise(
  typedClient.fromModel('primary', 'public', 'users').findMany({
    select: {
      name: true,
      profile: {
        select: {
          display_name: true,
        },
      },
      projects: {
        select: {
          id: true,
        },
      },
    },
  }),
)

acceptsProjectFindManyPromise(
  typedClient.fromModel('primary', 'public', 'projects').findMany({
    select: {
      title: true,
      tags: {
        select: {
          label: true,
        },
      },
    },
  }),
)

// @ts-expect-error unknown model key should not type-check
typedClient.fromModel('primary', 'public', 'missing_table').select()

// @ts-expect-error unknown tenant key should not type-check
typedClient.withTenantContext({ unknown: 'value' })

// @ts-expect-error unknown model-filter column should not type-check
typedClient.fromModel('primary', 'public', 'organizations').eq('missing_column', 'x')

// @ts-expect-error insert payload should match model InsertOf type
typedClient.fromModel('primary', 'public', 'organizations').insert({ slug: 'missing-owner' })
interface ProfileFormRow {
  id: string
  display_name: string | null
  age: number | null
  active: boolean
}

const profileFormModel = defineModel<ProfileFormRow>({
  meta: {
    database: 'primary',
    schema: 'public',
    model: 'profiles',
    primaryKey: ['id'],
    nullable: {
      id: false,
      display_name: true,
      age: true,
      active: false,
    },
  },
})

type ProfileFormValues = ModelFormValues<typeof profileFormModel>
type ProfileFormDefaults = ModelFormDefaults<typeof profileFormModel>

declare function acceptsProfileFormValues(value: ProfileFormValues): void
declare function acceptsProfileFormDefaults(value: ProfileFormDefaults): void
declare function acceptsProfileInsert(value: Partial<ProfileFormRow>): void

const profileDefaults = toModelFormDefaults(profileFormModel, {
  id: 'p_1',
  display_name: null,
  age: null,
  active: true,
})
acceptsProfileFormDefaults(profileDefaults)

const explicitUndefinedDefaults = toModelFormDefaults(
  profileFormModel,
  { id: 'p_1', display_name: null, age: null, active: true },
  { nullishMode: 'undefined' },
)
acceptsProfileFormDefaults(explicitUndefinedDefaults)

const profilePayload = toModelPayload(profileFormModel, {
  id: 'p_1',
  display_name: '',
  age: '',
  active: true,
})
acceptsProfileInsert(profilePayload)

const profileAdapter = createModelFormAdapter(profileFormModel)
acceptsProfileFormDefaults(profileAdapter.toDefaults({ display_name: null, age: null }))
acceptsProfileInsert(profileAdapter.toInsert({ display_name: '', age: '' }))
acceptsProfileInsert(profileAdapter.toUpdate({ display_name: '', age: '' }))

acceptsProfileFormValues({
  id: 'p_1',
  display_name: '',
  age: '',
  active: true,
})

const invalidProfileFormValues: ProfileFormValues = {
  id: 'p_1',
  display_name: '',
  age: '',
  // @ts-expect-error non-nullable boolean field cannot be a string
  active: '',
}
acceptsProfileFormValues(invalidProfileFormValues)

const generatorConfig = defineGeneratorConfig({
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
    database: 'app_db',
  },
  output: {
    targets: {
      model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
      schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
      database: 'src/generated/{database_kebab}/index.ts',
      registry: 'src/generated/index.ts',
    },
    placeholderMap: {
      namespace: '{database_kebab}/{schema_kebab}',
    },
  },
  naming: {
    modelType: 'pascal',
    modelConst: 'camel',
    schemaConst: 'camel',
    databaseConst: 'camel',
    registryConst: 'camel',
  },
})

declare function acceptsPostgresProviderKind(value: 'postgres'): void
acceptsPostgresProviderKind(generatorConfig.provider.kind)

defineGeneratorConfig({
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
  },
  output: {
    targets: {
      model: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
      schema: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
      database: 'src/generated/{database_kebab}/index.ts',
      registry: 'src/generated/index.ts',
    },
    placeholderMap: {},
  },
  naming: {
    // @ts-expect-error naming style must be one of preserve/camel/pascal/snake/kebab
    modelType: 'invalid-style',
  },
})
