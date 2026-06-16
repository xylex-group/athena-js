import {
  createTypedClient,
  createClient,
  AthenaClient,
  boolean,
  createModelFormAdapter,
  defineGeneratorConfig,
  generatorEnv,
  athenaAuth,
  defineAthenaAuthConfig,
  defineDatabase,
  defineModel,
  defineRegistry,
  defineSchema,
  enumeration,
  getAthenaDebugAst,
  normalizeAthenaGatewayBaseUrl,
  isOk,
  json,
  number,
  requireAffected,
  requireSuccess,
  string,
  table,
  toModelFormDefaults,
  toModelPayload,
  unwrap,
  unwrapOne,
  unwrapRows,
  verifyAthenaGatewayUrl,
  AthenaStorageErrorCode,
  createAthenaStorageError,
  type RequireAffectedOptions,
  type AthenaResult,
  type AthenaQueryDebugAst,
  type AthenaGatewayConnectionResult,
  type FormValuesOf,
  type ModelFormDefaults,
  type ModelFormValues,
  type InsertOf,
  type RowOf,
  type UpdateOf,
  type AthenaAdminListUsersQuery,
  type AthenaAdminListUsersSearchOperator,
  type AthenaAdminListUsersFilterOperator,
  type AthenaStorageModule,
  type AthenaStorageBinaryCallOptions,
  type AthenaStorageClientConfig,
  type AthenaStorageErrorDetails,
  type AthenaStorageErrorHandler,
  type AthenaStorageFileUploadResult,
  type S3CatalogItem,
  type StorageFileAccessPurpose,
  type StorageFileMutationResponse,
  type StorageListFilesResponse,
  type StorageUploadUrlResponse,
} from "../src/index.ts"
import type {
  AthenaStateAdapter,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  UseStorageUploadOptions,
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
declare function acceptsStorageFileAccessPurpose(value: StorageFileAccessPurpose): void
declare function acceptsUnknown(value: unknown): void
declare function acceptsResponsePromise(value: Promise<Response>): void
declare function acceptsGatewayConnectionPromise(
  value: Promise<AthenaGatewayConnectionResult>,
): void
declare function acceptsStorageBinaryCallOptions(value: AthenaStorageBinaryCallOptions): void
declare function acceptsStorageModule(value: AthenaStorageModule): void
declare function acceptsStorageConfig(value: AthenaStorageClientConfig): void
declare function acceptsStorageErrorDetails(value: AthenaStorageErrorDetails): void
declare function acceptsStorageErrorHandler(value: AthenaStorageErrorHandler): void
declare function acceptsStorageCatalogListPromise(
  value: Promise<{ data: S3CatalogItem[] }>,
): void
declare function acceptsStorageUploadUrlPromise(
  value: Promise<StorageUploadUrlResponse>,
): void
declare function acceptsStorageFileUploadResultPromise(
  value: Promise<AthenaStorageFileUploadResult>,
): void
declare function acceptsStorageListFilesPromise(
  value: Promise<StorageListFilesResponse>,
): void
declare function acceptsStorageFileMutationPromise(
  value: Promise<StorageFileMutationResponse>,
): void
declare function acceptsResponseArrayPromise(value: Promise<Response[]>): void

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
    debugAst: true,
    enableErrorNormalization: true,
    findManyAst: true,
    retryReads: true,
    traceQueries: {
      logger: event => {
        acceptsString(event.operation)
        acceptsString(event.sql)
        acceptsUnknown(event.ast)
      },
    },
  },
})
const strictColumnsClient = createClient('https://mirror3.athena-db.com', 'api-key', {
  experimental: {
    typecheckColumns: true,
  },
})
const strictColumnsBuilderClient = AthenaClient.builder()
  .url('https://mirror3.athena-db.com')
  .key('api-key')
  .experimental({
    typecheckColumns: true,
  })
  .build()
const experimentalStorageClient = createClient("https://mirror3.athena-db.com", "api-key", {
  experimental: {
    athenaStorageBackend: true,
    storage: {
      prefixPath: 'orgs/{organization_id}/env/{env.STAGE}',
      vars: { organization_id: 'org_1' },
      env: { STAGE: 'test' },
      onError(error) {
        acceptsStorageErrorDetails(error.toDetails())
      },
    },
  },
})
const experimentalStorageBuilderClient = AthenaClient.builder()
  .url("https://mirror3.athena-db.com")
  .key("api-key")
  .experimental({
    athenaStorageBackend: true,
  })
  .build()
const experimentalStorageOptionsBuilderClient = AthenaClient.builder()
  .url("https://mirror3.athena-db.com")
  .key("api-key")
  .options({
    experimental: {
      athenaStorageBackend: true,
    },
  })
  .build()
const normalizedGatewayUrl = normalizeAthenaGatewayBaseUrl('https://mirror3.athena-db.com/')
acceptsString(normalizedGatewayUrl)
acceptsGatewayConnectionPromise(client.verifyConnection())
acceptsGatewayConnectionPromise(verifyAthenaGatewayUrl('https://mirror3.athena-db.com'))
acceptsStorageModule(experimentalStorageClient.storage)
acceptsStorageModule(experimentalStorageBuilderClient.storage)
acceptsStorageModule(experimentalStorageOptionsBuilderClient.storage)
acceptsStorageFileAccessPurpose('stream')
acceptsStorageErrorHandler(error => {
  acceptsStorageErrorDetails(error.toDetails())
})
acceptsStorageConfig({
  prefixPath: context => `orgs/${context.organization_id}`,
  env: { ATHENA_STORAGE_PREFIX: 'typed-test' },
  onError(error) {
    acceptsStorageErrorDetails(error.toDetails())
  },
})
acceptsStorageBinaryCallOptions({
  onError(error) {
    acceptsStorageErrorDetails(error.toDetails())
  },
})
acceptsStorageErrorDetails(
  createAthenaStorageError({
    code: AthenaStorageErrorCode.InvalidUrl,
    message: "invalid storage URL",
    status: 0,
    endpoint: "/storage/catalogs",
    method: "GET",
  }).toDetails(),
)
acceptsStorageCatalogListPromise(experimentalStorageClient.storage.listStorageCatalogs())
acceptsStorageUploadUrlPromise(
  experimentalStorageClient.storage.createStorageUploadUrl({
    s3_id: 's3_1',
    storage_key: 'reports/report.pdf',
  }),
)
experimentalStorageClient.storage.getStorageFileUrl('file_1', { purpose: 'download' }).then(result => {
  acceptsString(result.url)
})
acceptsResponsePromise(
  experimentalStorageClient.storage.getStorageFileProxy('file_1', { purpose: 'stream' }),
)
acceptsStorageFileUploadResultPromise(
  experimentalStorageClient.storage.file.upload({
    s3_id: 's3_1',
    files: new Blob(['hello'], { type: 'text/plain' }),
    fileName: 'report.txt',
    extensions: ['txt', '.pdf'],
    maxFiles: 1,
    maxFileSizeMb: 10,
    vars: { organization_id: 'org_1' },
  }),
)
const maybeDebugAst = getAthenaDebugAst({}) as AthenaQueryDebugAst | null
acceptsUnknown(maybeDebugAst)
acceptsStorageListFilesPromise(
  experimentalStorageClient.storage.file.list({
    s3_id: 's3_1',
    prefix: 'reports',
  }),
)
acceptsResponsePromise(experimentalStorageClient.storage.file.download('file_1'))
acceptsResponseArrayPromise(experimentalStorageClient.storage.file.download(['file_1', 'file_2']))
acceptsStorageFileMutationPromise(experimentalStorageClient.storage.file.delete('file_1'))
acceptsStorageFileMutationPromise(experimentalStorageClient.storage.delete('file_1'))
const storageUploadHookOptions: UseStorageUploadOptions = {
  storage: experimentalStorageClient.storage,
  s3_id: 's3_1',
  fileName: 'report.txt',
}
acceptsUnknown(storageUploadHookOptions)
// @ts-expect-error storage bindings are exposed only with experimental.athenaStorageBackend
client.storage.listStorageCatalogs()
const authSessionResult = client.auth.getSession()
const builderAuthSessionResult = fluentBuilderClient.auth.getSession()
const validSearchOperator: AthenaAdminListUsersSearchOperator = 'contains'
const validFilterOperator: AthenaAdminListUsersFilterOperator = 'eq'
const validAdminListUsersQuery = {
  filterField: 'id',
  filterOperator: validFilterOperator,
  searchField: 'email',
  searchOperator: validSearchOperator,
} satisfies AthenaAdminListUsersQuery
client.auth.admin.user.list({ query: validAdminListUsersQuery })

// @ts-expect-error searchOperator only accepts contains, starts_with, or ends_with
client.auth.admin.user.list({ query: { searchOperator: 'eq' } })
// @ts-expect-error filterOperator rejects empty-string drift
client.auth.admin.user.list({ query: { filterOperator: '' } })
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
client.from<UserRow>('users').select('missing_column')

const strictUsers = strictColumnsClient.from<UserRow>('users')
strictUsers.select('id, name')
strictUsers.select(['id', 'name'])
strictUsers.select('id,athena.user(id)')
strictUsers.single('id')
strictUsers.maybeSingle('id')
strictColumnsClient.db.select<UserRow>('users', 'id,name')
strictColumnsClient.db.from<UserRow>('users').select(['id', 'name'])
strictColumnsBuilderClient.rpc<UserRow>('list_users').eq('id', '1').order('name').select('id,name')

// @ts-expect-error strict simple select should reject unknown columns
strictUsers.select('missing_column')
// @ts-expect-error strict simple select lists should reject unknown columns
strictUsers.select('id, missing_column')
// @ts-expect-error strict array selects should reject unknown columns
strictUsers.select(['id', 'missing_column'] as const)
// @ts-expect-error strict db.from().select should reject unknown columns
strictColumnsClient.db.from<UserRow>('users').select('missing_column')
// @ts-expect-error strict rpc filter columns should reject unknown columns
strictColumnsBuilderClient.rpc<UserRow>('list_users').eq('missing_column', 'x')
// @ts-expect-error strict rpc order columns should reject unknown columns
strictColumnsBuilderClient.rpc<UserRow>('list_users').order('missing_column')

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

users.findMany({
  select: {
    id: true,
    name: true,
  },
  where: {
    or: [{ id: 'u-1' }, { name: { ilike: '%ali%' } }],
    not: { name: { ilike: '%blocked%' } },
  },
})

users.findMany({
  select: {
    id: true,
  },
  where: {
    // @ts-expect-error boolean or clauses must target exactly one known column
    or: [{ id: 'u-1', name: 'Alice' }],
  },
})

users.findMany({
  select: {
    id: true,
  },
  where: {
    // @ts-expect-error boolean not clauses only allow a single lossless scalar operator
    not: { name: { like: 'A%', ilike: '%a%' } },
  },
})

users.findMany({
  select: {
    id: true,
  },
  where: {
    // @ts-expect-error boolean not clauses reject array-valued operators
    not: { id: { in: ['u-1'] } },
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

const zeroStyleProfile = table('profiles')
  .schema('public')
  .columns({
    id: string().generated(),
    orgID: string().from('org_id'),
    display_name: string().optional(),
    age: number().optional(),
    active: boolean().defaulted(),
    settings: json<{ theme: 'light' | 'dark' }>(),
    mood: enumeration(['happy', 'sad'] as const).optional(),
  })
  .primaryKey('id')

type ZeroStyleProfileRow = RowOf<typeof zeroStyleProfile>
type ZeroStyleProfileInsert = InsertOf<typeof zeroStyleProfile>
type ZeroStyleProfileUpdate = UpdateOf<typeof zeroStyleProfile>
type ZeroStyleProfileFormValues = FormValuesOf<typeof zeroStyleProfile>

declare function acceptsZeroStyleProfileRow(value: ZeroStyleProfileRow): void
declare function acceptsZeroStyleProfileInsert(value: ZeroStyleProfileInsert): void
declare function acceptsZeroStyleProfileUpdate(value: ZeroStyleProfileUpdate): void
declare function acceptsZeroStyleProfileFormValues(value: ZeroStyleProfileFormValues): void
declare function acceptsZeroStyleProfileSchemaName(value: 'public'): void
declare function acceptsZeroStyleProfileTableName(value: 'profiles'): void
declare function acceptsZeroStyleProfileQualifiedName(value: 'public.profiles'): void
declare function acceptsZeroStyleProfileArrayPromiseLike(
  value: PromiseLike<AthenaResult<ZeroStyleProfileRow[]>>,
): void
declare function acceptsZeroStyleProfileInsertMutation(
  value: PromiseLike<AthenaResult<ZeroStyleProfileRow>>,
): void

acceptsZeroStyleProfileSchemaName(zeroStyleProfile.schemaName)
acceptsZeroStyleProfileTableName(zeroStyleProfile.tableName)
acceptsZeroStyleProfileQualifiedName(zeroStyleProfile.qualifiedName)

const zeroStyleRow = zeroStyleProfile.schemas.row.parse({
  id: 'prof_1',
  orgID: 'org_1',
  display_name: null,
  age: null,
  active: true,
  settings: { theme: 'light' },
  mood: null,
})
acceptsZeroStyleProfileRow(zeroStyleRow)

const zeroStyleInsert = zeroStyleProfile.schemas.insert.parse({
  orgID: 'org_1',
  settings: { theme: 'dark' },
})
acceptsZeroStyleProfileInsert(zeroStyleInsert)

const zeroStyleUpdate = zeroStyleProfile.schemas.update.parse({
  display_name: 'Ada',
  mood: 'happy',
})
acceptsZeroStyleProfileUpdate(zeroStyleUpdate)

acceptsZeroStyleProfileFormValues({
  orgID: 'org_1',
  display_name: '',
  age: '',
  active: true,
  settings: { theme: 'light' },
  mood: '',
})

// @ts-expect-error generated id should not be assignable on insert
const invalidZeroStyleInsert: ZeroStyleProfileInsert = { id: 'prof_1', orgID: 'org_1', settings: { theme: 'light' } }
acceptsZeroStyleProfileInsert(invalidZeroStyleInsert)

const zeroStyleRegistry = defineRegistry({
  zero: defineDatabase({
    public: defineSchema({
      profiles: zeroStyleProfile,
    }),
  }),
})

const zeroStyleTypedClient = createTypedClient(
  zeroStyleRegistry,
  'https://athena-db.com',
  'api-key',
)
const strictZeroStyleTypedClient = createTypedClient(
  zeroStyleRegistry,
  'https://athena-db.com',
  'api-key',
  {
    experimental: {
      typecheckColumns: true,
    },
  },
)

zeroStyleTypedClient
  .fromModel('zero', 'public', 'profiles')
  .insert({
    orgID: 'org_1',
    settings: { theme: 'dark' },
  })
  .select()
strictZeroStyleTypedClient.fromModel('zero', 'public', 'profiles').select('id,orgID')

// @ts-expect-error strict typed client select should reject unknown model columns
strictZeroStyleTypedClient.fromModel('zero', 'public', 'profiles').select('missing_column')

acceptsZeroStyleProfileArrayPromiseLike(
  client.from(zeroStyleProfile).eq('orgID', 'org_1').select(),
)
acceptsZeroStyleProfileArrayPromiseLike(
  client.db.from(zeroStyleProfile).eq('orgID', 'org_1').select(),
)
acceptsZeroStyleProfileInsertMutation(
  client.from(zeroStyleProfile).insert({
    orgID: 'org_1',
    settings: { theme: 'dark' },
  }).select(),
)

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

const minimalDirectGeneratorConfig = defineGeneratorConfig({
  provider: {
    kind: 'postgres',
    mode: 'direct',
  },
})

const minimalGatewayGeneratorConfig = defineGeneratorConfig({
  provider: {
    kind: 'postgres',
    mode: 'gateway',
  },
})

declare function acceptsPostgresProviderKind(value: 'postgres'): void
acceptsPostgresProviderKind(generatorConfig.provider.kind)
acceptsPostgresProviderKind(minimalDirectGeneratorConfig.provider.kind)
acceptsPostgresProviderKind(minimalGatewayGeneratorConfig.provider.kind)

const generatorConfigFromEnv = defineGeneratorConfig({
  provider: {
    kind: 'postgres',
    mode: 'direct',
    connectionString: generatorEnv('DATABASE_URL', {
      default: 'postgres://postgres:postgres@127.0.0.1:5432/app_db',
    }),
    database: generatorEnv('ATHENA_GENERATOR_DB', { default: 'app_db' }),
    schemas: generatorEnv.list('ATHENA_GENERATOR_SCHEMAS', { default: ['public', 'athena'] }),
  },
  output: {
    targets: {
      model: generatorEnv('ATHENA_GENERATOR_MODEL_TARGET', {
        default: 'src/generated/{database_kebab}/{schema_kebab}/{model_kebab}.model.ts',
      }),
      schema: generatorEnv('ATHENA_GENERATOR_SCHEMA_TARGET', {
        default: 'src/generated/{database_kebab}/{schema_kebab}/index.ts',
      }),
      database: generatorEnv('ATHENA_GENERATOR_DATABASE_TARGET', {
        default: 'src/generated/{database_kebab}/index.ts',
      }),
      registry: generatorEnv('ATHENA_GENERATOR_REGISTRY_TARGET', {
        default: 'src/generated/index.ts',
      }),
    },
    placeholderMap: generatorEnv.json('ATHENA_GENERATOR_PLACEHOLDER_MAP', {
      default: {
        namespace: '{database_kebab}/{schema_kebab}',
      },
    }),
  },
  naming: {
    modelType: generatorEnv.oneOf(
      'ATHENA_GENERATOR_MODEL_STYLE',
      ['preserve', 'camel', 'pascal', 'snake', 'kebab'] as const,
      { default: 'pascal' },
    ),
  },
  features: {
    emitRelations: generatorEnv.boolean('ATHENA_GENERATOR_EMIT_RELATIONS', { default: true }),
  },
  experimental: {
    postgresGatewayIntrospection: generatorEnv.boolean(
      'ATHENA_GENERATOR_POSTGRES_GATEWAY_INTROSPECTION',
      { default: false },
    ),
  },
})

acceptsPostgresProviderKind(generatorConfigFromEnv.provider.kind)

const authBootstrapConfig = defineAthenaAuthConfig({
  baseURL: 'https://app.example.com',
  secret: 'top-secret',
  database: { binding: 'DB' },
  socialProviders: {
    github: {
      clientId: 'github-client-id',
      clientSecret: 'github-client-secret',
      scope: ['repo', 'read:org', 'user:email'],
    },
  },
  plugins: [
    {
      id: 'cookie-after-plugin',
      version: 'test',
    },
  ],
})

const nativeAuth = athenaAuth(authBootstrapConfig)
acceptsUnknown(nativeAuth.database)
acceptsString(nativeAuth.cookies.sessionToken.name)
acceptsString(nativeAuth.$ERROR_CODES.HANDLER_NOT_CONFIGURED)
acceptsUnknown(nativeAuth.api)
acceptsResponsePromise(nativeAuth.handler(new Request('https://app.example.com/api/auth/session')))

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
