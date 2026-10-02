import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const sourceRoot = resolve(
  homedir(),
  "Documents",
  "GitHub",
  "athena",
  "packages",
  "athena-js",
);
const targetRoot = resolve(homedir(), "Documents", "GitHub", "athena-js");

const PRESERVED_PATHS = [
  ".git",
  "node_modules",
  ".tmp",
  ".release-evidence",
  ".package.json.publish-backup",
  ".env",
  ".env.local",
  ".npmrc",
  "architecture",
  "mcps",
  "test-sdk",
  ".xbp",
  "bun.lock",
  ".gitignore",
  "scripts/sync-mirror.mjs",
];

function isPreserved(relativePath) {
  const normalized = relativePath.split(sep).join("/").replace(/^\.\/+/, "");
  if (normalized.split("/").includes("node_modules")) {
    return true;
  }
  return PRESERVED_PATHS.some(
    (preserved) =>
      normalized === preserved || normalized.startsWith(`${preserved}/`),
  );
}

function copyTree(sourcePath, targetPath, relativePath = "") {
  const sourceStats = lstatSync(sourcePath);

  if (sourceStats.isDirectory()) {
    mkdirSync(targetPath, { recursive: true });
    for (const entry of readdirSync(sourcePath)) {
      const entryRelativePath = relativePath ? join(relativePath, entry) : entry;
      if (!isPreserved(entryRelativePath)) {
        copyTree(join(sourcePath, entry), join(targetPath, entry), entryRelativePath);
      }
    }
    return;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  if (sourceStats.isSymbolicLink()) {
    try {
      copyFileSync(sourcePath, targetPath);
    } catch (error) {
      if (error.code !== "EISDIR" && error.code !== "EPERM") {
        throw error;
      }
      symlinkSync(readlinkSync(sourcePath), targetPath);
    }
    return;
  }

  copyFileSync(sourcePath, targetPath);
}

function removeStaleEntries(sourcePath, targetPath, relativePath = "") {
  for (const entry of readdirSync(targetPath)) {
    const entryRelativePath = relativePath ? join(relativePath, entry) : entry;
    if (isPreserved(entryRelativePath)) {
      continue;
    }

    const sourceEntryPath = join(sourcePath, entry);
    const targetEntryPath = join(targetPath, entry);
    if (!lstatExists(sourceEntryPath)) {
      rmSync(targetEntryPath, { recursive: true, force: true });
      continue;
    }

    if (lstatSync(targetEntryPath).isDirectory() && lstatSync(sourceEntryPath).isDirectory()) {
      removeStaleEntries(sourceEntryPath, targetEntryPath, entryRelativePath);
    }
  }
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

if (!lstatSync(sourceRoot).isDirectory()) {
  throw new Error(`Mirror source does not exist: ${sourceRoot}`);
}

if (!lstatSync(targetRoot).isDirectory()) {
  throw new Error(`Mirror target does not exist: ${targetRoot}`);
}

const targetPackageJsonPath = join(targetRoot, "package.json");
let syncMirrorScript = "node scripts/sync-mirror.mjs";
try {
  const existingTargetPackage = JSON.parse(readFileSync(targetPackageJsonPath, "utf8"));
  syncMirrorScript =
    existingTargetPackage.scripts?.["sync:mirror"] ?? "node scripts/sync-mirror.mjs";
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

removeStaleEntries(sourceRoot, targetRoot);
copyTree(sourceRoot, targetRoot);

const mirroredPackage = JSON.parse(readFileSync(targetPackageJsonPath, "utf8"));
mirroredPackage.scripts ??= {};
mirroredPackage.scripts["sync:mirror"] = syncMirrorScript;
writeFileSync(
  targetPackageJsonPath,
  `${JSON.stringify(mirroredPackage, null, 2)}\n`,
  "utf8",
);

console.log(`Synced ${sourceRoot} -> ${targetRoot}`);
