import { createClient, type AthenaResult } from "../src/index.ts"

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
