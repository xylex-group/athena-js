import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

export interface LocalProjectIdentity {
  configPath: string;
  id: string;
  root: string;
  slug: string;
}

function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function localProjectSlug(id: string): string {
  return `p-${id.slice(0, 12)}`;
}

export function createLocalProjectIdentity(
  projectRoot: string,
  configPath: string
): LocalProjectIdentity {
  const root = canonicalPath(projectRoot);
  const resolvedConfigPath = canonicalPath(configPath);
  const id = createHash("sha256").update(root).digest("hex").slice(0, 32);
  return {
    configPath: resolvedConfigPath,
    id,
    root,
    slug: localProjectSlug(id),
  };
}

export function localRuntimeDirectory(projectRoot: string): string {
  return resolve(projectRoot, ".athena", "runtime");
}

export function localRuntimeStatePath(projectRoot: string): string {
  return resolve(localRuntimeDirectory(projectRoot), "postgres.json");
}

export function localContainerName(identity: LocalProjectIdentity): string {
  return `athena-postgres-${identity.slug}`;
}

export function localVolumeName(identity: LocalProjectIdentity): string {
  return `athena-postgres-${identity.slug}`;
}

export function configRelativeToRoot(identity: LocalProjectIdentity): string {
  return (
    relative(identity.root, identity.configPath) ||
    basename(identity.configPath)
  );
}
