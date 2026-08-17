# Database transactions

Athena has two transaction APIs. They are not interchangeable.

| API | When to use | What the backend must provide |
| --- | --- | --- |
| `db.transaction([…])` | A finite list of operations is known before execution | One atomic unit (PG `BEGIN`/`COMMIT`, one Gateway request, or one D1 `batch()`) |
| `db.withTransaction(async tx => …)` | Application JavaScript runs between statements | A live connection-scoped transaction |

Feature-detect via `client.capabilities.db.transactions` ([ADR 0020](adr/0020-client-capabilities-and-edge-layer-honesty.md), [ADR 0025](adr/0025-athena-database-transactions.md)).

## Portable atomic

```ts
const [debit, credit, ledger] = await athena.db.transaction([
  athena.from(Account).eq("id", debitId).update({ balance: 900 }),
  athena.from(Account).eq("id", creditId).update({ balance: 1100 }),
  athena.from(Ledger).insert({
    id: transactionId,
    debitId,
    creditId,
    amount: 100,
  }),
] as const)
```

Tuple types follow each executable. Operations are compiled to semantic Athena payloads (not debug SQL) and executed by the transport.

## Interactive (capability-gated)

```ts
if (!athena.capabilities.db.transactions.interactive) {
  throw new Error("This backend cannot run interactive transactions")
}

const result = await athena.db.withTransaction(async (tx) => {
  const account = await tx.from(Account).eq("id", accountId).select().single()
  await tx.from(Account).eq("id", accountId).update({
    balance: account.data.balance - 100,
  })
  return account.data
})
```

`tx` is a **database** surface (`from` / `insert` / `update` / `delete`). It does not expose auth, storage, billing, or chat.

On D1 this throws `ATHENA_TRANSACTION_INTERACTIVE_UNSUPPORTED`. Use `db.transaction([…])` instead. Athena never simulates interactivity with independent D1 calls.

## Backend matrix

| Backend | Atomic | Interactive |
| --- | --- | --- |
| Direct PostgreSQL (`db.pgUri`) | Yes | Yes (pinned `PoolClient`) |
| Gateway → PostgreSQL | Yes (`POST /gateway/transaction`) | No |
| D1 edge-local | Yes (`D1Database.batch()`, rolls back the sequence on failure) | No |
| Gateway → D1 | No until the whole semantic transaction is one D1 batch | No |

Unsupported isolation, nesting, or atomicity **fails closed**. Isolation on D1 is not ignored.

## Invariants

- One DSL: `athena.from(Model)` / `tx.from(Model)`.
- One client: `createClient()`.
- Transport owns execution. The DB module does not switch on postgres/d1/gateway strings.
- One frozen request context for the whole transaction.
- Athena Query cache observes **committed** results only.
- Database-only. D1 and R2 are not cross-resource transactional ([ADR 0015](adr/0015-execution-transport-and-cloudflare-edge.md)).
