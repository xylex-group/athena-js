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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { AthenaRuntimeOwnershipError } from "../../src/runtime/ownership.ts";
import { resolveAthenaRuntime } from "../../src/runtime/resolve.ts";
import { createLocalStorageModule } from "../../src/storage/local.ts";
import { storageSdkManifest } from "../../src/storage/module.ts";
import {
  createLocalStorageProvider,
  createLocalStorageProviderFromRoot,
} from "../../src/storage/runtime/providers/local-provider.ts";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");
const repoRoot = join(here, "../../../..");

const PAYLOAD = "hello-local-object-store";
const KEY = "docs/notes.txt";

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "athena-sdd-local-storage-"));
}

function localClient(root: string, prefix?: string) {
  return createClient({
    storage: { prefix, provider: "local", root } as never,
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

test("T-SEC-PREFIX: listing with a configured prefix hides sibling prefixes", async () => {
  const root = tmpRoot();
  mkdirSync(join(root, "tenant-a"), { recursive: true });
  mkdirSync(join(root, "tenant-b"), { recursive: true });
  writeFileSync(join(root, "tenant-a", "visible.txt"), "a");
  writeFileSync(join(root, "tenant-b", "secret.txt"), "b");

  const client = localClient(root, "tenant-a/");
  const listed = await client.storage.file.list({} as never);
  assert.equal(listedMentionsKey(listed, "visible.txt"), true);
  assert.equal(listedMentionsKey(listed, "tenant-b/secret.txt"), false);
  assert.equal(listedMentionsKey(listed, "secret.txt"), false);
});

test("T-IO-TEMP-LIST: local listings hide active upload staging files", async () => {
  const root = tmpRoot();
  writeFileSync(join(root, ".athena-upload-123.tmp"), "in progress");
  writeFileSync(join(root, "visible.txt"), "ready");

  const listed = await localClient(root).storage.file.list({} as never);
  assert.equal(listedMentionsKey(listed, "visible.txt"), true);
  assert.equal(listedMentionsKey(listed, ".athena-upload-123.tmp"), false);
});

test("T-SEC-STAGING-KEY: reject new collisions and preserve legacy object access", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const stagingKeys = [
    ".athena-upload-user.tmp",
    "folder/.athena-upload-user.tmp",
  ];

  for (const key of stagingKeys) {
    await assert.rejects(
      () =>
        client.storage.file.upload({
          files: new Uint8Array([1]),
          storage_key: key,
        } as never),
      /reserved local upload staging filename/i
    );
  }

  await client.storage.file.upload({
    files: new Uint8Array([1]),
    storage_key: "source.txt",
  } as never);
  await assert.rejects(
    () =>
      client.storage.file.move({
        from: "source.txt",
        to: stagingKeys[0],
      } as never),
    /reserved local upload staging filename/i
  );
  assert.equal(existsSync(join(root, "source.txt")), true);
  assert.equal(existsSync(join(root, stagingKeys[0])), false);

  writeFileSync(join(root, stagingKeys[0]), "legacy object");
  const legacy = await extractBytes(
    await client.storage.file.get(stagingKeys[0] as never)
  );
  assert.equal(new TextDecoder().decode(legacy), "legacy object");
  await client.storage.file.move({
    from: stagingKeys[0],
    to: "recovered.txt",
  } as never);
  assert.equal(
    readFileSync(join(root, "recovered.txt"), "utf8"),
    "legacy object"
  );
});

test("T-SEC-SYMLINK: local object operations reject symlinked ancestors", async (t) => {
  const root = tmpRoot();
  const outside = tmpRoot();
  writeFileSync(join(outside, "secret.txt"), "external");
  try {
    symlinkSync(outside, join(root, "linked"), "junction");
  } catch (error) {
    const code = errorCode(error);
    if (code === "EPERM" || code === "EACCES" || code === "UNKNOWN") {
      t.skip("the current Windows account cannot create a directory junction");
      return;
    }
    throw error;
  }

  const client = localClient(root);
  await assert.rejects(
    () =>
      client.storage.file.get({ storage_key: "linked/secret.txt" } as never),
    /symlink|symbolic link|outside storage root/i
  );
  await assert.rejects(
    () =>
      client.storage.file.upload({
        files: new Uint8Array([1]),
        storage_key: "linked/new.txt",
      } as never),
    /symlink|symbolic link|outside storage root/i
  );
  assert.equal(existsSync(join(outside, "new.txt")), false);
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

test("T-SEC-COLLISION: local conditional writes preserve existing objects", async () => {
  const root = tmpRoot();
  const provider = createLocalStorageProviderFromRoot({ root });
  const principal = {} as never;
  const first = await provider.execute({
    body: new TextEncoder().encode("original"),
    ifAbsent: true,
    key: "docs/occupied.txt",
    op: "put",
    principal,
  });
  assert.equal(first.ok, true);
  const collision = await provider.execute({
    body: new TextEncoder().encode("overwrite"),
    ifAbsent: true,
    key: "docs/occupied.txt",
    op: "put",
    principal,
  });
  assert.equal(collision.ok, false);
  assert.equal(collision.error?.errorNumber, 3006);
  assert.equal(
    readFileSync(join(root, "docs", "occupied.txt"), "utf8"),
    "original"
  );
});

test("T-CANCEL-LOCAL-WRITE: an aborted staged upload leaves no object behind", async () => {
  const root = tmpRoot();
  const storage = createLocalStorageModule({ root });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      storage.file.upload({
        files: new Uint8Array([1, 2, 3]),
        name: "cancelled.bin",
        signal: controller.signal,
        storage_key: "cancelled.bin",
      } as never),
    (error: unknown) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(existsSync(join(root, "cancelled.bin")), false);
  assert.equal(
    pathsUnderRoot(root).some((path) => path.endsWith(".tmp")),
    false
  );
});

test("T-IO-OVERWRITE: staged local uploads still replace existing objects", async () => {
  const root = tmpRoot();
  const storage = createLocalStorageModule({ root });
  await storage.file.upload({
    files: new TextEncoder().encode("first"),
    storage_key: "replace.txt",
  } as never);
  await storage.file.upload({
    files: new TextEncoder().encode("second"),
    storage_key: "replace.txt",
  } as never);

  assert.equal(readFileSync(join(root, "replace.txt"), "utf8"), "second");
});

test("T-CANCEL-LOCAL: local provider forwards an in-flight PUT signal", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  let finishUpload: (() => void) | undefined;
  const store = {
    file: {
      upload(input: { signal?: AbortSignal }) {
        observedSignal = input.signal;
        return new Promise<void>((_resolve, reject) => {
          finishUpload = () => _resolve();
          input.signal?.addEventListener(
            "abort",
            () =>
              reject(
                Object.assign(new Error("Upload aborted"), {
                  name: "AbortError",
                })
              ),
            { once: true }
          );
        });
      },
    },
  } as never;
  const provider = createLocalStorageProvider(store);
  const pending = provider.execute({
    body: new Uint8Array([1]),
    key: "pending.bin",
    op: "put",
    principal: {} as never,
    signal: controller.signal,
  });

  controller.abort();
  finishUpload?.();
  const result = await pending;

  assert.equal(observedSignal, controller.signal);
  assert.equal(result.ok, false);
});

test("T-SEC-MOVE-RACE: only one concurrent file move claims a destination", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const file = client.storage.file as typeof client.storage.file & {
    move: (input: unknown) => Promise<unknown>;
  };
  const sources = Array.from(
    { length: 8 },
    (_, index) => `source-${index}.txt`
  );
  for (const source of sources) {
    writeFileSync(join(root, source), source);
  }

  const results = await Promise.allSettled(
    sources.map((from) => file.move({ from, to: "destination.txt" }))
  );
  const succeeded = results.filter((result) => result.status === "fulfilled");
  assert.equal(succeeded.length, 1);
  assert.equal(existsSync(join(root, "destination.txt")), true);
  assert.ok(
    sources.includes(readFileSync(join(root, "destination.txt"), "utf8"))
  );
  assert.equal(
    sources.filter((source) => existsSync(join(root, source))).length,
    sources.length - 1
  );
});

test("T-SEC-FOLDER-MOVE-RACE: one concurrent folder move claims a destination", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const folder = client.storage.folder as typeof client.storage.folder & {
    move: (input: unknown) => Promise<unknown>;
  };
  mkdirSync(join(root, "source-a"));
  mkdirSync(join(root, "source-b"));
  writeFileSync(join(root, "source-b", "content.txt"), "source-b");

  const results = await Promise.allSettled([
    folder.move({ from: "source-a/", to: "destination/" }),
    folder.move({ from: "source-b/", to: "destination/" }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(existsSync(join(root, "destination")), true);
  assert.equal(
    Number(existsSync(join(root, "source-a"))) +
      Number(existsSync(join(root, "source-b"))),
    1
  );
  assert.equal(
    existsSync(join(root, "source-b", "content.txt")) ||
      existsSync(join(root, "destination", "content.txt")),
    true
  );
});

test("T-SEC-FOLDER-MOVE-WRITE: uploads during a move are never deleted", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const folder = client.storage.folder as typeof client.storage.folder & {
    move: (input: unknown) => Promise<unknown>;
  };
  mkdirSync(join(root, "source", "nested"), { recursive: true });
  for (let index = 0; index < 600; index += 1) {
    writeFileSync(
      join(root, "source", "nested", `file-${String(index).padStart(4, "0")}`),
      "existing"
    );
  }

  const moving = folder.move({ from: "source/", to: "destination/" });
  const copiedDirectory = join(root, "destination", "nested");
  const deadline = Date.now() + 10_000;
  while (
    !existsSync(copiedDirectory) ||
    readdirSync(copiedDirectory).length === 0
  ) {
    assert.ok(
      Date.now() < deadline,
      "folder move did not begin copying in time"
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  await client.storage.file.upload({
    files: new TextEncoder().encode("uploaded during move"),
    storage_key: "source/concurrent.txt",
  } as never);
  await moving;

  const sourceFile = join(root, "source", "concurrent.txt");
  const destinationFile = join(root, "destination", "concurrent.txt");
  assert.ok(existsSync(sourceFile) || existsSync(destinationFile));
  assert.equal(
    readFileSync(existsSync(sourceFile) ? sourceFile : destinationFile, "utf8"),
    "uploaded during move"
  );
});

test("T-SEC-FOLDER-MOVE-DELETE: a concurrent source delete waits for the move", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const file = client.storage.file as typeof client.storage.file & {
    delete: (key: unknown) => Promise<unknown>;
  };
  const folder = client.storage.folder as typeof client.storage.folder & {
    delete: (input: unknown) => Promise<unknown>;
    move: (input: unknown) => Promise<unknown>;
  };
  mkdirSync(join(root, "source"));
  for (let index = 0; index < 400; index += 1) {
    writeFileSync(
      join(root, "source", `file-${String(index).padStart(4, "0")}.txt`),
      "keep through move"
    );
  }

  const moving = folder.move({ from: "source/", to: "destination/" });
  const destination = join(root, "destination");
  const deadline = Date.now() + 10_000;
  while (!existsSync(destination) || readdirSync(destination).length === 0) {
    assert.ok(
      Date.now() < deadline,
      "folder move did not begin copying in time"
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  const deletingFile = file.delete("source/file-0399.txt");
  const deleting = folder.delete({ prefix: "source/" });
  await Promise.all([moving, deletingFile, deleting]);

  assert.equal(existsSync(join(root, "source")), false);
  assert.equal(readdirSync(destination).length, 400);
  assert.equal(
    readFileSync(join(destination, "file-0000.txt"), "utf8"),
    "keep through move"
  );
});

test("T-SEC-FOLDER-MOVE-CREATE: a concurrent folder creation waits for the move", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const folder = client.storage.folder as typeof client.storage.folder & {
    create: (input: unknown) => Promise<unknown>;
    move: (input: unknown) => Promise<unknown>;
  };
  mkdirSync(join(root, "source"));
  for (let index = 0; index < 400; index += 1) {
    writeFileSync(
      join(root, "source", `file-${String(index).padStart(4, "0")}.txt`),
      "keep through move"
    );
  }

  let moveSettled = false;
  const moving = folder
    .move({ from: "source/", to: "destination/" })
    .finally(() => {
      moveSettled = true;
    });
  let createSettled = false;
  const creating = folder
    .create({ prefix: "source/created-during-move/" })
    .then((result) => {
      createSettled = true;
      return result;
    });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  assert.equal(moveSettled, false, "test must observe the active folder move");
  assert.equal(
    createSettled,
    false,
    "folder creation must wait for the active move"
  );

  await Promise.all([moving, creating]);

  const destination = join(root, "destination");
  assert.equal(readdirSync(destination).length, 400);
  assert.equal(existsSync(join(root, "source", "created-during-move")), true);
});

test("T-SEC-FOLDER-MOVE-CLEANUP: failed copies release their reserved destination", async () => {
  const root = tmpRoot();
  const client = localClient(root);
  const folder = client.storage.folder as typeof client.storage.folder & {
    move: (input: unknown) => Promise<unknown>;
  };
  mkdirSync(join(root, "source"));
  for (let index = 0; index < 300; index += 1) {
    writeFileSync(
      join(root, "source", `file-${String(index).padStart(4, "0")}.txt`),
      "keep source"
    );
  }
  const sourceEntries = readdirSync(join(root, "source"));
  const firstEntry = sourceEntries[0];
  const removedEntry = sourceEntries.at(-1);
  assert.ok(firstEntry && removedEntry && firstEntry !== removedEntry);

  const moving = folder.move({ from: "source/", to: "destination/" });
  const copiedEntry = join(root, "destination", firstEntry);
  const deadline = Date.now() + 10_000;
  while (!existsSync(copiedEntry)) {
    assert.ok(
      Date.now() < deadline,
      "folder move did not begin copying in time"
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  unlinkSync(join(root, "source", removedEntry));

  await assert.rejects(moving);

  assert.equal(existsSync(join(root, "destination")), false);
  assert.equal(
    readFileSync(join(root, "source", firstEntry), "utf8"),
    "keep source"
  );
});

test("T-SEC-MOVE-ATOMIC: moves reserve destinations at the filesystem boundary", () => {
  const source = readFileSync(join(srcRoot, "storage", "local.ts"), "utf8");
  const fileMove = source.slice(
    source.indexOf("const moveFile ="),
    source.indexOf("const renameFile =")
  );
  const folderMove = source.slice(
    source.indexOf("const moveFolder ="),
    source.indexOf("const renameFolder =")
  );

  assert.match(fileMove, /\blink\(/);
  assert.doesNotMatch(fileMove, /\brename\(/);
  assert.match(folderMove, /mkdir\(toDest\.abs\)/);
  assert.doesNotMatch(folderMove, /\brename\(/);
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
