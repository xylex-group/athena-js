import { createClient, type SupabaseResult } from "../src/index.ts"

interface UserRow {
  id: string
  name: string
  email?: string | null
}

declare function acceptsUserPromise(value: Promise<SupabaseResult<UserRow>>): void
declare function acceptsUserArrayPromise(value: Promise<SupabaseResult<UserRow[]>>): void

declare function acceptsMaybeUserPromise(value: Promise<SupabaseResult<UserRow | null>>): void
declare function acceptsMaybeUserPickPromise(
  value: Promise<SupabaseResult<Pick<UserRow, "id"> | null>>,
): void

declare function acceptsUserInsertMutation(
  value: PromiseLike<SupabaseResult<UserRow>>,
): void
declare function acceptsUserArrayInsertMutation(
  value: PromiseLike<SupabaseResult<UserRow[]>>,
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

// @ts-expect-error insert(one) should not be inferred as array result
acceptsUserArrayPromise(users.insert({ id: "1", name: "Alice" }).select())

// @ts-expect-error insert(many) should not be inferred as single-row result
acceptsUserPromise(users.insert([{ id: "1", name: "Alice" }]).select())

// @ts-expect-error upsert(one) should not be inferred as array result
acceptsUserArrayPromise(users.upsert({ id: "1", name: "Alice" }, { onConflict: "id" }).select())

// @ts-expect-error upsert(many) should not be inferred as single-row result
acceptsUserPromise(users.upsert([{ id: "1", name: "Alice" }], { onConflict: "id" }).select())

declare function acceptsUserPickArrayPromise(
  value: PromiseLike<SupabaseResult<Array<Pick<UserRow, "id">>>>,
): void
