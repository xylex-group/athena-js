import {
  createClient,
  isOk,
  requireAffected,
  requireSuccess,
  unwrap,
  unwrapOne,
  unwrapRows,
  type RequireAffectedOptions,
  type AthenaResult,
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

declare function acceptsUserInsertMutation(
  value: PromiseLike<AthenaResult<UserRow>>,
): void
declare function acceptsUserArrayInsertMutation(
  value: PromiseLike<AthenaResult<UserRow[]>>,
): void

const client = createClient("https://athena-db.com", "api-key")
const users = client.from<UserRow>("users")

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

const queryHookResult = {} as UseQueryResult<UserRow[]>
acceptsUserQueryHookResult(queryHookResult)

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
