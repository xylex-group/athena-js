/**
 * Target contract: catalog-optional local ObjectStore behind athena.storage.file.*.
 * RED on CURRENT code until implement. See SPEC + ADR 0027.
 *
 * Desired: trusted Node createClient({ storage: { provider: "local", root } })
 * materializes a filesystem ObjectStore. file.upload/get/head/delete/list
 * work without connectionId, s3_id, or Athena catalog. Reject traversal.
 * Unsupported ops throw ATHENA_STORAGE_CAPABILITY_UNSUPPORTED.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { AthenaRuntimeOwnershipError } from "../../src/runtime/ownership.ts";
import { resolveAthenaRuntime } from "../../src/runtime/resolve.ts";
import { storageSdkManifest } from "../../src/storage/module.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const repoRoot = join(here, "../../../..");

const PAYLOAD = "hello-local-object-store";
const KEY = "docs/notes.txt";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "athena-sdd-local-storage-"));
}

function localClient(root: string) {
  return createClient({
    storage: { provider: "local", root } as never,
  });
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
}

function hasCapabilityUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    errorCode(error) === "ATHENA_STORAGE_CAPABILITY_UNSUPPORTED" ||
    message.includes("ATHENA_STORAGE_CAPABILITY_UNSUPPORTED")
  );
}

function isFailClosedLocal(error: unknown): boolean {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    code.includes("STORAGE") ||
    code === "ATHENA_NODE_RUNTIME_REQUIRED" ||
    code === "ATHENA_AUTH_LOCAL_NODE_REQUIRED" ||
    /local/i.test(message) ||
    /node/i.test(code)
  );
}

function listedMentionsKey(listed: unknown, key: string): boolean {
  return JSON.stringify(listed).includes(key);
}

async function extractBytes(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (typeof Response !== "undefined" && value instanceof Response) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const candidate of [
      record.body,
      record.bytes,
      record.data,
      record.content,
    ]) {
      if (candidate !== undefined && candidate !== value) {
        return extractBytes(candidate);
      }
    }
  }
  throw new Error(
    `file.get must return object bytes, got ${Object.prototype.toString.call(value)}`
  );
}

function pathsUnderRoot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

test("T-CON-01: Node createClient({ storage: { provider: 'local', root } }) is a runtime", () => {
  const root = tmpRoot();
  const client = localClient(root);
  const plan = getAthenaClientInternals(client)?.plan;
  assert.ok(plan, "root internals/plan missing");
  assert.equal(plan.storage.transport, "local");
  assert.notEqual(plan.storage.transport, "none");
  assert.notEqual(plan.storage.transport, "http");
});

test("T-IO-01: file.upload writes under root without connectionId or s3_id", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const uploaded = await client.storage.file.upload({
    content_type: "text/plain",
    files: new TextEncoder().encode(PAYLOAD),
    name: "notes.txt",
    storage_key: KEY,
  } as never);
  assert.ok(uploaded);
  const onDisk = join(root, "docs", "notes.txt");
  assert.equal(
    existsSync(onDisk),
    true,
    "expected bytes under configured root"
  );
  assert.equal(readFileSync(onDisk, "utf8"), PAYLOAD);
  for (const path of pathsUnderRoot(root)) {
    assert.equal(
      resolve(path).startsWith(resolve(root) + sep) ||
        resolve(path) === resolve(root),
      true,
      `wrote outside root: ${path}`
    );
  }
});

test("T-IO-02: file get/head/delete/list round-trip without catalog ids", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  await client.storage.file.upload({
    files: new TextEncoder().encode(PAYLOAD),
    name: "notes.txt",
    storage_key: KEY,
  } as never);

  const fileNs = client.storage.file as typeof client.storage.file & {
    head?: (input: unknown) => Promise<unknown>;
  };
  assert.equal(typeof fileNs.get, "function");
  const head = fileNs.head;
  if (typeof head !== "function") {
    assert.fail("file.head must exist on local runtime");
  }
  assert.equal(typeof fileNs.delete, "function");
  assert.equal(typeof fileNs.list, "function");

  const listed = await fileNs.list({ prefix: "docs" } as never);
  assert.ok(listedMentionsKey(listed, KEY), "list must include uploaded key");

  const headed = await head({ storage_key: KEY } as never);
  assert.ok(headed);

  const got = await fileNs.get(KEY as never);
  const bytes = await extractBytes(got);
  assert.equal(new TextDecoder().decode(bytes), PAYLOAD);

  await fileNs.delete(KEY);
  assert.equal(existsSync(join(root, "docs", "notes.txt")), false);
  const after = await fileNs.list({ prefix: "docs" } as never);
  assert.equal(listedMentionsKey(after, KEY), false);
});

test("T-SEC-01: reject .. and resolve only under root", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const body = new Uint8Array([1]);
  const forbidden = [
    "../escape.txt",
    "..\\escape.txt",
    "/tmp/absolute-escape.txt",
    "docs/../../outside.txt",
    "docs/\0evil.txt",
  ];
  for (const storage_key of forbidden) {
    await assert.rejects(
      () =>
        client.storage.file.upload({
          files: body,
          storage_key,
        } as never),
      (error: unknown) =>
        error instanceof Error &&
        (/\.\./.test(error.message) ||
          /travers/i.test(error.message) ||
          /escape/i.test(error.message) ||
          /invalid/i.test(error.message) ||
          /unsafe/i.test(error.message)),
      `expected reject for key ${storage_key}`
    );
  }
  assert.equal(existsSync(join(root, "..", "escape.txt")), false);
  assert.equal(existsSync(join(root, "outside.txt")), false);
  assert.equal(pathsUnderRoot(root).length, 0);
});

test("T-ERR-01: presign/retention/acl throw ATHENA_STORAGE_CAPABILITY_UNSUPPORTED", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  await assert.rejects(
    () => client.storage.object.uploadUrl({ key: "a.txt" } as never),
    hasCapabilityUnsupported
  );
  await assert.rejects(
    () => client.storage.file.retention.set("a.txt", {} as never),
    hasCapabilityUnsupported
  );
  await assert.rejects(
    () =>
      client.storage.permissions.grant("a.txt", {
        action: "read",
        principalId: "u1",
        principalType: "user",
      }),
    hasCapabilityUnsupported
  );
});

test("T-IO-06: folder.create/rename and file.move keep keys under root", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const storage = client.storage as typeof client.storage & {
    folder: {
      create: (input: unknown) => Promise<unknown>;
      rename: (input: unknown) => Promise<unknown>;
    };
    file: typeof client.storage.file & {
      move: (input: unknown) => Promise<unknown>;
    };
  };
  await storage.folder.create({ name: "docs", prefix: "" });
  assert.equal(existsSync(join(root, "docs")), true);
  const progress: Array<{ phase: string; fileName: string }> = [];
  const payload = new File(["hello"], "notes.txt", { type: "text/plain" });
  await storage.file.upload({
    files: [payload],
    onProgress: (event: { phase: string; fileName: string }) => {
      progress.push(event);
    },
    prefixPath: "docs/",
  } as never);
  assert.equal(existsSync(join(root, "docs", "notes.txt")), true);
  await storage.file.move({
    from: "docs/notes.txt",
    to: "docs/renamed.txt",
  } as never);
  assert.equal(existsSync(join(root, "docs", "renamed.txt")), true);
  await storage.folder.rename({
    from: "docs/",
    name: "files",
  });
  assert.equal(existsSync(join(root, "files")), true);
  assert.ok(progress.some((event) => event.phase === "uploading"));
});

test("T-ERR-02: ATHENA_STORAGE_CAPABILITY_UNSUPPORTED is a real error code", () => {
  const errorsTs = readFileSync(join(srcRoot, "storage/errors.ts"), "utf8");
  assert.match(errorsTs, /ATHENA_STORAGE_CAPABILITY_UNSUPPORTED/);
});

test("T-OWN-01: request view borrows local backend; close does not dispose root", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  await client.storage.file.upload({
    files: new TextEncoder().encode("owned-by-root"),
    storage_key: "owned.txt",
  } as never);
  const view = client.withContext({ userId: "u1" });
  const viewInternals = getAthenaClientInternals(view);
  assert.equal(viewInternals?.ownership, "request");
  const listed = await view.storage.file.list({} as never);
  assert.ok(listedMentionsKey(listed, "owned.txt"));
  await assert.rejects(
    () => (view as unknown as typeof client).close(),
    (error: unknown) =>
      error instanceof AthenaRuntimeOwnershipError &&
      error.code === "ATHENA_RUNTIME_OWNERSHIP_INVALID"
  );
  assert.equal(existsSync(join(root, "owned.txt")), true);
  const still = await client.storage.file.list({} as never);
  assert.ok(listedMentionsKey(still, "owned.txt"));
});

test("T-BND-01: non-Node rejects provider local", () => {
  const config = {
    storage: { provider: "local", root: "/tmp" } as {
      url?: string | null;
      r2?: unknown;
    },
  };
  assert.throws(
    () =>
      resolveAthenaRuntime(config, {
        environment: "browser",
        trustedNode: false,
      }),
    isFailClosedLocal
  );
  assert.throws(
    () =>
      resolveAthenaRuntime(config, {
        environment: "react-native",
        trustedNode: false,
      }),
    isFailClosedLocal
  );
});

test("T-BND-02: local adapter / node:fs stay off browser and RN entries", () => {
  const browser = readFileSync(join(srcRoot, "browser.ts"), "utf8");
  const rn = readFileSync(join(srcRoot, "react-native", "index.ts"), "utf8");
  const rnClient = readFileSync(
    join(srcRoot, "react-native", "client.ts"),
    "utf8"
  );
  const core = readFileSync(join(srcRoot, "v3-client-core.ts"), "utf8");
  const audit = readFileSync(
    join(here, "..", "..", "scripts", "audit-browser-bundle-safety.mjs"),
    "utf8"
  );
  for (const [label, source] of [
    ["browser.ts", browser],
    ["react-native/index.ts", rn],
    ["react-native/client.ts", rnClient],
    ["v3-client-core.ts", core],
  ] as const) {
    assert.doesNotMatch(
      source,
      /from\s+["']node:fs(?:\/promises)?["']/,
      `${label} must not import node:fs`
    );
    assert.doesNotMatch(
      source,
      /storage\/local/,
      `${label} must not statically import the local adapter`
    );
  }
  assert.match(audit, /node:fs/);
});

test("T-MAN-01: storageSdkManifest METHOD+path set is not shrunk", () => {
  const inventory = JSON.parse(
    readFileSync(
      join(repoRoot, "contracts/storage/live-http-routes.json"),
      "utf8"
    ).replace(/^\uFEFF/, "")
  ) as { routes: { method: string; path: string }[] };
  assert.ok(storageSdkManifest.methods.length >= 70);
  assert.equal(storageSdkManifest.methods.length, inventory.routes.length);
  const methods = new Set(
    storageSdkManifest.methods.map((row) => `${row.method} ${row.path}`)
  );
  for (const route of inventory.routes) {
    assert.equal(
      methods.has(`${route.method} ${route.path}`),
      true,
      `manifest missing ${route.method} ${route.path}`
    );
  }
});
