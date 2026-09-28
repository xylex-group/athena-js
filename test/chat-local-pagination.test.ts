import assert from "node:assert/strict";
import test from "node:test";
import { createLocalChatRuntime } from "../src/chat/local/runtime.ts";
import { createMemoryChatStore } from "../src/chat/local/store.ts";
import type { AthenaResolvedPrincipal } from "../src/runtime/data/principal.ts";

function principal(userId: string): AthenaResolvedPrincipal {
  return {
    authority: "custom-trusted",
    principal: {
      authenticated: true,
      grants: [],
      organizationId: "org-1",
      rights: [],
      userId,
    },
  };
}

test("local room listing honors limit and offset", async () => {
  const runtime = createLocalChatRuntime({
    resolvePrincipal: async () => principal("user-1"),
    store: createMemoryChatStore(),
  });

  await runtime.room.create({ kind: "group", title: "one" });
  await runtime.room.create({ kind: "group", title: "two" });
  await runtime.room.create({ kind: "group", title: "three" });

  const allRooms = await runtime.room.list();
  const page = await runtime.room.list({ limit: 1, offset: 1 });

  assert.equal(allRooms.items.length, 3);
  assert.deepEqual(
    page.items.map((room) => room.id),
    [allRooms.items[1]?.id]
  );

  const clampedPage = await runtime.room.list({ limit: 0, offset: -10 });
  assert.equal(clampedPage.items.length, 1);
});
