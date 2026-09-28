/**
 * Packed-product authorization proof: rights authorize, roles package,
 * snapshots revise, inspectors observe.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { produceAthenaDevtoolsAuthorizationInspector } from "../../src/devtools/produce/authorization.ts";
import { MemoryAuthorizationStore } from "../../src/runtime/authorization/memory.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const authUiRoot = join(pkgRoot, "..", "athena-auth-ui", "src");

const ROLE_NAME_SHORTCUT =
  /(?:user|member)\.role\s*(?:===|==)\s*["'](?:admin|owner)["']/;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(next));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(next);
    }
  }
  return out;
}

test("P?: authorization decisions do not use user.role or member.role name shortcuts", () => {
  const roots = [
    join(srcRoot, "runtime", "authorization"),
    join(srcRoot, "auth", "local", "authorization-routes.ts"),
    join(srcRoot, "auth", "local", "authorization-guard.ts"),
    join(srcRoot, "runtime", "data", "rights-resolution.ts"),
    join(srcRoot, "devtools", "produce", "authorization.ts"),
    join(authUiRoot, "components", "auth", "authorization"),
  ];
  const hits: string[] = [];
  for (const root of roots) {
    const files =
      existsSync(root) && !root.endsWith(".ts")
        ? walkFiles(root)
        : existsSync(root)
          ? [root]
          : [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (ROLE_NAME_SHORTCUT.test(source)) {
        hits.push(file);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("P?: DevTools inspector reflects revision, source, capabilities, and catalog without mutating assignments", async () => {
  const store = new MemoryAuthorizationStore();
  await store.materialize();
  const before = await store.inspectGraph();
  let assigns = 0;
  const original = store.assignUserRole.bind(store);
  store.assignUserRole = async (userId, roleKey, assignedBy) => {
    assigns += 1;
    return original(userId, roleKey, assignedBy);
  };
  const inspector = await produceAthenaDevtoolsAuthorizationInspector({
    internals: {
      getAuthStores: async () => ({ authorization: store }) as never,
    } as never,
  });
  assert.equal(assigns, 0);
  assert.equal(inspector.source, "memory");
  assert.equal(typeof inspector.revision, "number");
  assert.ok((inspector.revision ?? 0) >= 1);
  assert.equal(inspector.revision, before.revision);
  assert.ok(inspector.catalog.rights.length > 0);
  assert.equal(
    inspector.catalogState.fingerprint,
    inspector.catalog.fingerprint
  );
  assert.equal(
    inspector.catalogState.rightCount,
    inspector.catalog.rights.length
  );
  assert.equal(inspector.capabilities, null);
  assert.ok(Array.isArray(inspector.roles));
  assert.ok(Array.isArray(inspector.audit.entries));
  const after = await store.inspectGraph();
  assert.equal(after.assignments.length, before.assignments.length);
  assert.equal(after.revision, before.revision);
});
