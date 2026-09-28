import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  bigint,
  boolean,
  createModelFormAdapter,
  decimal,
  enumeration,
  integer,
  json,
  number,
  numeric,
  smallint,
  string,
  table,
} from "../src/index.ts";
import { getColumnConfig } from "../src/schema/table-columns.ts";

const account = table("accounts")
  .schema("public")
  .columns({
    age: number().optional(),
    id: string().generated(),
    is_active: boolean().defaulted(),
    metadata: json<{ nested: string }>(),
    mood: enumeration(["happy", "sad"] as const).optional(),
    name: string(),
    orgID: string().from("org_id"),
    settings: json(z.object({ theme: z.enum(["light", "dark"]) })),
  })
  .primaryKey("id");

test("decimal() is a precision-safe string-backed column with optional precision/scale", () => {
  const products = table("products")
    .schema("public")
    .columns({
      amount: numeric().precision(10).scale(4),
      id: number(),
      price: decimal({ precision: 12, scale: 2 }).optional(),
    })
    .primaryKey("id");

  assert.equal(products.meta.columns?.price?.kind, "decimal");
  assert.equal(products.meta.columns?.price?.precision, 12);
  assert.equal(products.meta.columns?.price?.scale, 2);
  assert.equal(products.meta.columns?.price?.nullable, true);
  assert.equal(products.meta.columns?.amount?.kind, "decimal");
  assert.equal(products.meta.columns?.amount?.precision, 10);
  assert.equal(products.meta.columns?.amount?.scale, 4);

  const rowSchema = products.schemas.row;
  assert.deepEqual(rowSchema.parse({ amount: "1.5", id: 1, price: "19.99" }), {
    amount: "1.5",
    id: 1,
    price: "19.99",
  });
});

test("width-aware integer schemas reject fractional, out-of-range, and invalid bigint values", () => {
  const values = table("integer_values").columns({
    small_id: smallint(),
    integer_id: integer(),
    big_id: bigint(),
  }).primaryKey("small_id");

  assert.equal(
    values.schemas.row.safeParse({
      small_id: -32768,
      integer_id: 2147483647,
      big_id: "9223372036854775807",
    }).success,
    true
  );
  assert.equal(
    values.schemas.row.safeParse({
      small_id: 32767,
      integer_id: -2147483648,
      big_id: "-9223372036854775808",
    }).success,
    true
  );

  for (const input of [
    { small_id: 1.5, integer_id: 1, big_id: "1" },
    { small_id: 32768, integer_id: 1, big_id: "1" },
    { small_id: 1, integer_id: 2147483648, big_id: "1" },
    { small_id: 1, integer_id: 1, big_id: "9223372036854775808" },
    { small_id: 1, integer_id: 1, big_id: "not-an-integer" },
  ]) {
    assert.equal(values.schemas.row.safeParse(input).success, false, input);
  }
});

test("identity columns preserve mode and follow PostgreSQL insert/update contracts", () => {
  const identities = table("identities")
    .columns({
      always_id: integer().identity("always"),
      default_id: bigint().identity("by-default"),
      legacy_default_id: number().identity("by-default"),
      name: string(),
    })
    .primaryKey("always_id");

  assert.equal(identities.meta.columns?.always_id?.identity, "always");
  assert.deepEqual(
    identities.meta.columns?.always_id?.generationStrategy,
    { kind: "identity", mode: "always" }
  );
  assert.equal(identities.meta.columns?.always_id?.isGenerated, false);
  assert.equal(identities.meta.columns?.default_id?.identity, "by-default");
  assert.equal(
    identities.schemas.insert.safeParse({ name: "Ada" }).success,
    true
  );
  assert.equal(
    identities.schemas.insert.safeParse({ always_id: 1, name: "Ada" }).success,
    false
  );
  assert.equal(
    identities.schemas.insert.safeParse({ legacy_default_id: 2, name: "Ada" })
      .success,
    true
  );
  assert.equal(
    identities.schemas.update.safeParse({ always_id: 1 }).success,
    false
  );
  assert.equal(
    identities.schemas.update.safeParse({ default_id: "2" }).success,
    true
  );
  assert.equal(
    identities.schemas.update.safeParse({ legacy_default_id: 2 }).success,
    true
  );
});

test("identity columns reject nullable and generated modifier transitions", () => {
  const identity = integer().optional();
  const identityModifier = Reflect.get(identity, "identity");
  if (typeof identityModifier !== "function") {
    throw new Error("Expected the runtime identity modifier");
  }
  assert.throws(
    () => Reflect.apply(identityModifier, identity, ["always"]),
    /Identity columns cannot be nullable/
  );
  const configuredIdentity = integer().identity("always");
  const optional = Reflect.get(configuredIdentity, "optional");
  if (typeof optional !== "function") {
    throw new Error("Expected the runtime optional modifier");
  }
  assert.throws(
    () => Reflect.apply(optional, configuredIdentity, []),
    /Identity columns cannot be optional/
  );
  const generated = Reflect.get(configuredIdentity, "generated");
  if (typeof generated !== "function") {
    throw new Error("Expected the runtime generated modifier");
  }
  assert.throws(
    () => Reflect.apply(generated, configuredIdentity, []),
    /Identity columns cannot also be generated/
  );
});

test("integer builders expose identity and number retains the legacy bridge", () => {
  assert.equal("identity" in number(), true);
  assert.equal("identity" in string(), false);
  assert.equal("identity" in json(), false);
  assert.equal("identity" in decimal(), false);
  assert.equal("identity" in smallint(), true);
  assert.equal("identity" in integer(), true);
  assert.equal("identity" in bigint(), true);
});

test("integer builders do not expose decimal precision or scale modifiers", () => {
  assert.equal("precision" in smallint(), false);
  assert.equal("scale" in integer(), false);
  assert.equal("precision" in bigint(), false);
  assert.equal("precision" in decimal(), true);
  assert.equal("scale" in decimal(), true);
});

test("number identity remains a deprecated legacy identity contract", () => {
  const legacyIdentity = number().identity("always");
  const config = getColumnConfig(legacyIdentity);

  assert.equal(config.kind, "number");
  assert.equal(config.identity, "always");
  assert.deepEqual(config.generationStrategy, {
    kind: "identity",
    mode: "always",
  });
  assert.equal(config.hasDefault, true);
  assert.equal(config.nullable, false);
  assert.equal(config.isGenerated, false);
});

test("configured identity builders do not expose a second identity transition", () => {
  assert.equal("identity" in integer().identity("always"), false);
  assert.equal("identity" in number().identity("by-default"), false);
  assert.equal("identity" in integer().generated(), false);
  assert.equal("identity" in number().generated(), false);
});

test("table builder stores schema-aware metadata and explicit column mappings", () => {
  assert.equal(account.kind, "table");
  assert.equal(account.name, "accounts");
  assert.equal(account.mappedName, undefined);
  assert.equal(account.schemaName, "public");
  assert.equal(account.tableName, "accounts");
  assert.equal(account.qualifiedName, "public.accounts");
  assert.equal(account.meta.schema, "public");
  assert.equal(account.meta.model, "accounts");
  assert.deepEqual(account.meta.primaryKey, ["id"]);
  assert.equal(account.meta.columns?.orgID?.columnName, "org_id");
  assert.equal(account.meta.columns?.id?.isGenerated, true);
  assert.equal(account.meta.columns?.is_active?.hasDefault, true);
  assert.equal(account.meta.columns?.mood?.kind, "enumeration");
  assert.deepEqual(account.meta.columns?.mood?.enumValues, ["happy", "sad"]);
});

test("table builder allows zero-arg primaryKey for tables without a primary key", () => {
  const auditLog = table("audit_log")
    .schema("athena")
    .columns({
      action: string(),
      id: string(),
    })
    .primaryKey();

  assert.equal(auditLog.kind, "table");
  assert.equal(auditLog.schemaName, "athena");
  assert.equal(auditLog.tableName, "audit_log");
  assert.deepEqual(auditLog.meta.primaryKey, []);
});

test("table builder exposes withoutPrimaryKey as the canonical no-pk helper", () => {
  const account = table("account")
    .schema("athena")
    .columns({
      id: string(),
      user_id: string(),
    })
    .withoutPrimaryKey();

  assert.equal(account.kind, "table");
  assert.equal(account.schemaName, "athena");
  assert.equal(account.tableName, "account");
  assert.deepEqual(account.meta.primaryKey, []);
});

test("table builder supports separate schema() and from() mapping", () => {
  const userPref = table("userPref")
    .schema("public")
    .from("user_pref")
    .columns({
      id: string(),
    })
    .primaryKey("id");

  assert.equal(userPref.name, "userPref");
  assert.equal(userPref.mappedName, "user_pref");
  assert.equal(userPref.schemaName, "public");
  assert.equal(userPref.tableName, "user_pref");
  assert.equal(userPref.qualifiedName, "public.user_pref");
  assert.equal(userPref.meta.schema, "public");
  assert.equal(userPref.meta.model, "userPref");
  assert.equal(userPref.meta.tableName, "user_pref");
});

test("table builder still supports schema-qualified from() inputs", () => {
  const auditLog = table("audit_logs")
    .from("analytics.audit_logs")
    .columns({
      id: string(),
    })
    .primaryKey("id");

  assert.equal(auditLog.schemaName, "analytics");
  assert.equal(auditLog.tableName, "audit_logs");
  assert.equal(auditLog.qualifiedName, "analytics.audit_logs");
});

test("table builder rejects conflicting explicit schema and schema-qualified from() targets", () => {
  assert.throws(
    () => table("accounts").schema("public").from("analytics.accounts"),
    /conflicts with mapped table "analytics\.accounts"/
  );

  assert.throws(
    () => table("accounts").from("analytics.accounts").schema("public"),
    /conflicts with mapped table "analytics\.accounts"/
  );
});

test("table builder derives row, insert, and update schemas from column flags", () => {
  const row = account.schemas.row.parse({
    age: null,
    id: "acct_1",
    is_active: true,
    metadata: 42,
    mood: null,
    name: "Ada",
    orgID: "org_1",
    settings: { theme: "light" },
  });

  assert.equal(row.id, "acct_1");
  assert.equal(row.age, null);
  assert.equal(row.metadata, 42);

  const insert = account.schemas.insert.parse({
    id: "ignore-me",
    metadata: { nested: "ok" },
    name: "Ada",
    orgID: "org_1",
    settings: { theme: "dark" },
  });

  assert.equal("id" in insert, false);
  assert.equal(insert.is_active, undefined);
  assert.equal(insert.age, undefined);
  assert.deepEqual(insert.settings, { theme: "dark" });

  const update = account.schemas.update.parse({
    id: "ignore-me",
    mood: "happy",
  });

  assert.equal("id" in update, false);
  assert.equal(update.mood, "happy");

  assert.throws(
    () =>
      account.schemas.row.parse({
        age: null,
        id: "acct_1",
        is_active: true,
        metadata: {},
        mood: null,
        name: "Ada",
        orgID: "org_1",
        settings: { theme: "sepia" },
      }),
    /Invalid option/
  );
});

test("table builder form schema normalizes empty strings and model adapters stay compatible", () => {
  const parsed = account.schemas.form.parse({
    age: "",
    metadata: { nested: "ok" },
    mood: "",
    name: "Ada",
    orgID: "org_1",
    settings: { theme: "light" },
  });

  assert.deepEqual(parsed, {
    age: null,
    metadata: { nested: "ok" },
    mood: null,
    name: "Ada",
    orgID: "org_1",
    settings: { theme: "light" },
  });

  const adapter = createModelFormAdapter(account);
  assert.deepEqual(
    adapter.toDefaults({
      age: null,
      mood: null,
    }),
    {
      age: "",
      mood: "",
    }
  );
  assert.deepEqual(
    adapter.toInsert({
      age: "",
      metadata: { nested: "ok" },
      mood: "",
      name: "Ada",
      orgID: "org_1",
      settings: { theme: "light" },
    }),
    {
      age: null,
      metadata: { nested: "ok" },
      mood: null,
      name: "Ada",
      orgID: "org_1",
      settings: { theme: "light" },
    }
  );
});
