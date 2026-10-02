import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";
import { createPostgresAuthDatabase } from "../../src/auth/local/database.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";

function databaseUrl(): string | undefined {
  const value = (
    process.env.ATHENA_TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  ).trim();
  return /^postgres(?:ql)?:\/\//i.test(value) ? value : undefined;
}

const url = databaseUrl();
const maybe = url ? test : test.skip;

function testHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

async function signUp(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  email: string
) {
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({ email, password: "Password123!" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie") ?? "";
}

async function post(
  runtime: ReturnType<typeof createAthenaAuthRuntime>,
  path: string,
  cookie: string,
  body: unknown
) {
  return runtime.handle(
    new Request(`http://app.local/api/auth/organization/${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    })
  );
}

maybe(
  "Postgres organization lifecycle feed filters and pages real audit rows",
  async () => {
    const database = await createPostgresAuthDatabase(url as string);
    const runtime = createAthenaAuthRuntime({
      autoMigrate: true,
      config: normalizeAthenaAuthConfig({
        mode: "local",
        observability: { auditLog: true },
        security: { trustedOrigins: ["http://app.local"] },
      }),
      database,
      hasher: testHasher(),
    });
    const suffix = crypto.randomUUID();
    try {
      const ownerCookie = await signUp(
        runtime,
        `lifecycle-owner-${suffix}@example.com`
      );
      await signUp(runtime, `lifecycle-target-${suffix}@example.com`);
      const stores = await runtime.getStores();
      const owner = await stores.getUserByEmail(
        `lifecycle-owner-${suffix}@example.com`
      );
      const target = await stores.getUserByEmail(
        `lifecycle-target-${suffix}@example.com`
      );
      assert.ok(owner);
      assert.ok(target);

      const organization = await stores.createOrganization({
        createdByUserId: owner.id,
        id: `lifecycle-org-${suffix}`,
        name: "Lifecycle Integration",
        slug: `lifecycle-${suffix}`,
      });
      await stores.addMember({
        id: `lifecycle-owner-member-${suffix}`,
        organizationId: organization.id,
        role: "owner",
        userId: owner.id,
      });
      const ownerSession = (await stores.listUserSessions(owner.id))[0];
      assert.ok(ownerSession);
      await stores.setSessionActiveOrganization(
        ownerSession.token,
        organization.id
      );

      const add = await post(runtime, "add-member", ownerCookie, {
        organizationId: organization.id,
        role: "member",
        userId: target.id,
      });
      assert.equal(add.status, 200);
      const member = (await stores.listMembers(organization.id)).find(
        (item) => item.user_id === target.id
      );
      assert.ok(member);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const update = await post(runtime, "update-member-role", ownerCookie, {
        memberId: member.id,
        organizationId: organization.id,
        role: "admin",
      });
      assert.equal(update.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const cloneResponse = await runtime.handle(
        new Request("http://app.local/api/auth/authorization/roles/clone", {
          body: JSON.stringify({
            name: `Lifecycle reviewer ${suffix}`,
            sourceRoleId: "organization_member",
          }),
          headers: { "content-type": "application/json", cookie: ownerCookie },
          method: "POST",
        })
      );
      assert.equal(cloneResponse.status, 200);
      const cloned = (await cloneResponse.json()) as {
        role: { id: string; version: number };
      };
      const assignmentSnapshot =
        await stores.authorization.readMemberRoleAssignmentsSnapshot({
          organizationId: organization.id,
        });
      const assignmentUpdate = await runtime.handle(
        new Request(
          `http://app.local/api/auth/authorization/assignments/members/${member.id}`,
          {
            body: JSON.stringify({
              expectedVersion: assignmentSnapshot.revision,
              roleIds: [cloned.role.id, "organization_member"],
            }),
            headers: {
              "content-type": "application/json",
              cookie: ownerCookie,
            },
            method: "PUT",
          }
        )
      );
      assert.equal(assignmentUpdate.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const roleDelete = await runtime.handle(
        new Request(
          `http://app.local/api/auth/authorization/roles/${cloned.role.id}`,
          {
            body: JSON.stringify({
              expectedVersion: cloned.role.version,
              reassignmentRoleId: "organization_member",
            }),
            headers: { "content-type": "application/json", cookie: ownerCookie },
            method: "DELETE",
          }
        )
      );
      assert.equal(roleDelete.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const remove = await post(runtime, "remove-member", ownerCookie, {
        memberId: member.id,
        organizationId: organization.id,
      });
      assert.equal(remove.status, 200);

      const list = (organizationId: string, cursor?: string) =>
        runtime.handle(
          new Request(
            `http://app.local/api/auth/organization/list-lifecycle-events?organizationId=${organizationId}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
            { headers: { cookie: ownerCookie } }
          )
        );
      const page1Response = await list(organization.id);
      assert.equal(page1Response.status, 200);
      const page1 = (await page1Response.json()) as {
        events: Array<{
          event: string;
          eventId: string;
          subjectUserId: string;
        }>;
        nextCursor: string | null;
      };
      assert.equal(page1.events[0]?.event, "organization.member.remove");
      assert.equal(page1.events[0]?.subjectUserId, target.id);
      assert.ok(page1.nextCursor);

      const page2Response = await list(organization.id, page1.nextCursor);
      assert.equal(page2Response.status, 200);
      const page2 = (await page2Response.json()) as typeof page1;
      assert.equal(page2.events[0]?.event, "organization.member.role.update");
      assert.equal(page2.events[0]?.subjectUserId, target.id);
      assert.ok(page2.nextCursor);

      const page3Response = await list(organization.id, page2.nextCursor);
      assert.equal(page3Response.status, 200);
      const page3 = (await page3Response.json()) as typeof page1;
      assert.equal(page3.events[0]?.event, "organization.member.role.update");
      assert.equal(page3.events[0]?.subjectUserId, target.id);
      assert.ok(page3.nextCursor);

      const page4Response = await list(organization.id, page3.nextCursor);
      assert.equal(page4Response.status, 200);
      const page4 = (await page4Response.json()) as typeof page1;
      assert.equal(page4.events[0]?.event, "organization.member.role.update");
      assert.equal(page4.events[0]?.subjectUserId, target.id);
      assert.ok(page4.nextCursor);
      const page5Response = await list(organization.id, page4.nextCursor);
      assert.equal(page5Response.status, 200);
      const page5 = (await page5Response.json()) as typeof page1;
      assert.equal(page5.events[0]?.event, "organization.member.add");
      assert.equal(page5.events[0]?.subjectUserId, target.id);
      assert.equal(page5.nextCursor, null);

      const ids = [
        page1.events[0]?.eventId,
        page2.events[0]?.eventId,
        page3.events[0]?.eventId,
        page4.events[0]?.eventId,
        page5.events[0]?.eventId,
      ];
      assert.equal(new Set(ids).size, 5);
      const otherOrganization = await stores.createOrganization({
        createdByUserId: owner.id,
        id: `lifecycle-other-org-${suffix}`,
        name: "Other Lifecycle Integration",
        slug: `lifecycle-other-${suffix}`,
      });
      await stores.addMember({
        id: `lifecycle-other-owner-${suffix}`,
        organizationId: otherOrganization.id,
        role: "owner",
        userId: owner.id,
      });
      await stores.setSessionActiveOrganization(
        ownerSession.token,
        otherOrganization.id
      );
      const isolatedResponse = await list(otherOrganization.id);
      assert.equal(isolatedResponse.status, 200);
      assert.deepEqual(await isolatedResponse.json(), {
        events: [],
        nextCursor: null,
      });
    } finally {
      await runtime.close();
      await database.close?.();
    }
  }
);
