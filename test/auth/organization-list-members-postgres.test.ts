import assert from "node:assert/strict";
import { test } from "node:test";

import { generateApiKey } from "../../src/auth/local/api-key.ts";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { migrateAthenaAuthSchema } from "../../src/auth/local/schema.ts";
import { PostgresAuthStores } from "../../src/auth/local/stores.ts";

const databaseUrl =
  process.env.ATHENA_TEST_DATABASE_URL || process.env.DATABASE_URL;
const maybe = databaseUrl?.startsWith("postgres") ? test : test.skip;

maybe(
  "Postgres list-members accepts only organization-scoped members.read API keys",
  async () => {
    const database = await createPostgresAuthDatabase(databaseUrl as string);
    const suffix = crypto.randomUUID();
    const userId = `members-read-${suffix}`;
    const organizationId = `members-read-org-${suffix}`;
    const runtime = createAthenaAuthRuntime({
      autoMigrate: false,
      database,
      secret: `members-read-secret-${suffix}`,
    });

    try {
      await migrateAthenaAuthSchema(database);
      const stores = new PostgresAuthStores(database);
      await stores.authorization.ensureCatalog();
      await stores.createUser({
        email: `${suffix}@example.com`,
        id: userId,
        name: "Members Read Integration",
      });
      await stores.createOrganization({
        createdByUserId: userId,
        id: organizationId,
        name: "Members Read Integration",
        slug: `members-read-${suffix}`,
      });
      await stores.addMember({
        id: `members-read-member-${suffix}`,
        organizationId,
        role: "owner",
        userId,
      });
      const otherOrganizationId = `members-read-other-org-${suffix}`;
      await stores.createOrganization({
        createdByUserId: userId,
        id: otherOrganizationId,
        name: "Other Members Read Integration",
        slug: `members-read-other-${suffix}`,
      });

      const makeCredential = async (permissions: string[]) => {
        const generated = await generateApiKey();
        await stores.createApiKey({
          created_at: new Date(),
          enabled: true,
          expires_at: null,
          id: `members-read-key-${crypto.randomUUID()}`,
          key: generated.hash,
          last_request: null,
          metadata: null,
          name: "Members read integration",
          organization_id: organizationId,
          permissions: JSON.stringify({ organization: permissions }),
          prefix: null,
          remaining: null,
          scope_kind: "organization",
          start: generated.start,
          updated_at: new Date(),
          user_id: userId,
        });
        return generated.fullKey;
      };

      const allowedKey = await makeCredential(["members.read"]);
      const deniedKey = await makeCredential([]);
      const listMembers = (key: string, requestedOrganizationId?: string) => {
        const url = new URL(
          "http://app.local/api/auth/organization/list-members"
        );
        if (requestedOrganizationId) {
          url.searchParams.set("organizationId", requestedOrganizationId);
        }
        return runtime.handle(
          new Request(url, { headers: { authorization: `Bearer ${key}` } })
        );
      };

      const allowed = await listMembers(allowedKey, organizationId);
      assert.equal(allowed.status, 200);
      assert.equal(
        ((await allowed.json()) as { members: unknown[] }).members.length,
        1
      );
      const defaulted = await listMembers(allowedKey);
      assert.equal(defaulted.status, 200);
      assert.equal(
        ((await defaulted.json()) as { members: unknown[] }).members.length,
        1
      );
      assert.equal(
        (await listMembers(allowedKey, otherOrganizationId)).status,
        403
      );

      const denied = await listMembers(deniedKey);
      assert.equal(denied.status, 403);
    } finally {
      await runtime.close();
    }
  }
);
