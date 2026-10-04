import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { normalizeAthenaAuthConfig } from "../../src/auth/config.ts";
import { ATHENA_AUTH_EVENT_DEFINITIONS } from "../../src/auth/domain/catalog.ts";
import { ATHENA_AUTH_DOMAIN_EVENTS } from "../../src/auth/hooks/events.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAuthRouter } from "../../src/auth/local/router.ts";
import { createRuntimeDependencies } from "../../src/auth/local/runtime-dependencies.ts";
import { PLATFORM_CUSTOMER_ROLE } from "../../src/runtime/authorization/templates.ts";

function testHasher() {
  return {
    async hash(password: string) {
      return `hash:${password}`;
    },
    needsRehash() {
      return false;
    },
    async verify(password: string, hash: string) {
      return hash === `hash:${password}`;
    },
  };
}

function cookieOf(response: Response): string {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

test("authorization assignment and role lifecycle events have audited Event IR", () => {
  const expected = {
    "authorization.role.create": ["create", "authorization.role"],
    "authorization.role.delete": ["delete", "authorization.role"],
    "authorization.role.rights.replace": ["update", "authorization.role"],
    "authorization.role.update": ["update", "authorization.role"],
    "authorization.user.roles.replace": ["update", "platform.user"],
  } as const;

  for (const [event, [mutationKind, subjectType]] of Object.entries(expected)) {
    assert.equal(
      ATHENA_AUTH_DOMAIN_EVENTS[event as keyof typeof ATHENA_AUTH_DOMAIN_EVENTS]
        ?.status,
      "implemented"
    );
    assert.deepEqual(
      {
        audit:
          ATHENA_AUTH_EVENT_DEFINITIONS[
            event as keyof typeof ATHENA_AUTH_EVENT_DEFINITIONS
          ]?.audit,
        mutationKind:
          ATHENA_AUTH_EVENT_DEFINITIONS[
            event as keyof typeof ATHENA_AUTH_EVENT_DEFINITIONS
          ]?.mutationKind,
        subjectType:
          ATHENA_AUTH_EVENT_DEFINITIONS[
            event as keyof typeof ATHENA_AUTH_EVENT_DEFINITIONS
          ]?.subjectType,
      },
      { audit: true, mutationKind, subjectType }
    );
  }
});

test("authorization mutations emit Event IR and no-op assignment is silent", async () => {
  const events: unknown[] = [];
  const stores = new MemoryAuthStores();
  const deps = createRuntimeDependencies({
    config: normalizeAthenaAuthConfig({
      mode: "local",
      secret: "authorization-event-test-secret",
    }),
    hasher: testHasher(),
    hooks: {
      after: {
        "authorization.role.create": (event) => events.push(event),
        "authorization.role.delete": (event) => events.push(event),
        "authorization.role.rights.replace": (event) => events.push(event),
        "authorization.role.update": (event) => events.push(event),
        "authorization.user.roles.replace": (event) => events.push(event),
      },
    },
    stores,
  });
  try {
    const ready = await deps.ensureReady();
    const router = createAuthRouter(deps);
    const signUp = async (email: string) =>
      router.handleRoute(
        new Request("https://auth.example/api/auth/sign-up/email", {
          body: JSON.stringify({ email, password: "Password123!" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        "/sign-up/email",
        ready,
        new Headers(),
        "trace-authorization-event"
      );
    const actorResponse = await signUp("authorization-event-admin@example.com");
    await signUp("authorization-event-target@example.com");
    const actorCookie = cookieOf(actorResponse);
    const actor = await stores.getUserByEmail(
      "authorization-event-admin@example.com"
    );
    const target = await stores.getUserByEmail(
      "authorization-event-target@example.com"
    );
    assert.ok(actor);
    assert.ok(target);
    await stores.updateUser(actor.id, { role: "admin" });
    const before = await stores.authorization.readUserRoleAssignmentsSnapshot({
      userIds: [target.id],
    });
    const previousRoleIds = before.assignments[0]?.roleIds ?? [];
    const response = await router.handleRoute(
      new Request(
        `https://auth.example/api/auth/authorization/assignments/users/${target.id}`,
        {
          body: JSON.stringify({
            expectedVersion: before.revision,
            roleIds: [],
          }),
          headers: { "content-type": "application/json", cookie: actorCookie },
          method: "PUT",
        }
      ),
      `/authorization/assignments/users/${target.id}`,
      ready,
      new Headers(),
      "trace-authorization-event"
    );
    assert.equal(response.status, 200);
    assert.equal(events.length, 1);
    const event = events[0] as {
      event: string;
      previous: {
        changes: readonly { roleIds: readonly string[]; userId: string }[];
      };
      result: {
        changes: readonly {
          roleIds: readonly string[];
          user: { id: string };
        }[];
      };
    };
    assert.equal(event.event, "authorization.user.roles.replace");
    assert.deepEqual(event.previous.changes, [
      { roleIds: previousRoleIds, userId: target.id },
    ]);
    assert.deepEqual(event.result.changes[0]?.roleIds, []);
    assert.deepEqual(event.result.changes[0]?.previousRoleIds, previousRoleIds);
    assert.equal(event.result.changes[0]?.user.id, target.id);

    const noOpVersion =
      await stores.authorization.readUserRoleAssignmentsSnapshot({
        userIds: [target.id],
      });
    const noOp = await router.handleRoute(
      new Request(
        `https://auth.example/api/auth/authorization/assignments/users/${target.id}`,
        {
          body: JSON.stringify({
            expectedVersion: noOpVersion.revision,
            roleIds: [],
          }),
          headers: { "content-type": "application/json", cookie: actorCookie },
          method: "PUT",
        }
      ),
      `/authorization/assignments/users/${target.id}`,
      ready,
      new Headers(),
      "trace-authorization-event"
    );
    assert.equal(noOp.status, 200);
    assert.equal(events.length, 1);

    const request = (method: string, path: string, body: unknown) =>
      router.handleRoute(
        new Request(`https://auth.example/api/auth${path}`, {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json", cookie: actorCookie },
          method,
        }),
        path,
        ready,
        new Headers(),
        "trace-authorization-event"
      );
    const createResponse = await request("POST", "/authorization/roles", {
      name: "Event role",
      rights: [],
      scope: "platform",
    });
    assert.equal(createResponse.status, 200);
    const created = (await createResponse.json()) as {
      role: { id: string; key: string; version: number };
    };
    const updateResponse = await request(
      "PATCH",
      `/authorization/roles/${created.role.id}`,
      {
        expectedVersion: created.role.version,
        name: "Renamed role",
        scope: "platform",
      }
    );
    assert.equal(updateResponse.status, 200);
    const updated = (await updateResponse.json()) as {
      role: { id: string; version: number };
    };
    const rightsResponse = await request(
      "PUT",
      `/authorization/roles/${updated.role.id}/rights`,
      { expectedVersion: updated.role.version, rights: [], scope: "platform" }
    );
    assert.equal(rightsResponse.status, 200);
    const rightsUpdated = (await rightsResponse.json()) as {
      role: { id: string; version: number };
    };
    await stores.authorization.assignUserRole(
      target.id,
      created.role.key,
      "pre-delete-grantor"
    );
    const deleteResponse = await request(
      "DELETE",
      `/authorization/roles/${rightsUpdated.role.id}`,
      {
        expectedVersion: rightsUpdated.role.version,
        reassignmentRoleId: PLATFORM_CUSTOMER_ROLE,
        scope: "platform",
      }
    );
    assert.equal(deleteResponse.status, 200);
    const replacementGrant = stores.authorization
      .snapshot()
      .userRoles.get(target.id)
      ?.get(PLATFORM_CUSTOMER_ROLE);
    assert.equal(replacementGrant?.assignedBy, actor.id);
    assert.deepEqual(
      (events as { event: string }[]).map(({ event }) => event),
      [
        "authorization.user.roles.replace",
        "authorization.role.create",
        "authorization.role.update",
        "authorization.role.rights.replace",
        "authorization.role.delete",
        "authorization.user.roles.replace",
      ]
    );
    const reassignment = events[5] as {
      event: string;
      previous: {
        changes: readonly { roleIds: readonly string[]; userId: string }[];
      };
      result: {
        changes: readonly {
          roleIds: readonly string[];
          previousRoleIds: readonly string[];
        }[];
      };
    };
    assert.equal(reassignment.event, "authorization.user.roles.replace");
    assert.deepEqual(reassignment.previous.changes[0]?.roleIds, [
      created.role.id,
    ]);
    assert.deepEqual(reassignment.result.changes[0]?.roleIds, [
      PLATFORM_CUSTOMER_ROLE,
    ]);
  } finally {
    await deps.close();
  }
});
