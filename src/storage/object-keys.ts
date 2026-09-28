/**
 * Canonical object-store key helpers for local + overlay storage.
 * Rename is a specialized move: parent prefix stays, basename changes.
 */

export function normalizeObjectPrefix(
  prefix: string | undefined | null
): string {
  if (!prefix?.trim()) {
    return "";
  }
  return `${prefix.replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

export function joinObjectKey(prefix: string, name: string): string {
  const base = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  const part = name.replace(/^\/+/, "");
  if (!base) {
    return part;
  }
  if (!part) {
    return base;
  }
  return `${base}/${part}`;
}

export function parentObjectPrefix(key: string): string {
  const clean = key.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) {
    return "";
  }
  const parts = clean.split("/");
  parts.pop();
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

export function objectBaseName(key: string): string {
  const clean = key.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) {
    return "";
  }
  const parts = clean.split("/");
  return parts[parts.length - 1] ?? "";
}

export function isFolderPrefixInside(
  sourcePrefix: string,
  destinationPrefix: string
): boolean {
  const source = normalizeObjectPrefix(sourcePrefix);
  const destination = normalizeObjectPrefix(destinationPrefix);
  if (!source) {
    return false;
  }
  return destination === source || destination.startsWith(source);
}

export function renameObjectKey(
  key: string,
  newName: string,
  folder: boolean
): string {
  const parent = parentObjectPrefix(key);
  const name = newName.replace(/^\/+/, "").replace(/\/+$/, "");
  if (folder) {
    return `${joinObjectKey(parent, name)}/`;
  }
  return joinObjectKey(parent, name);
}

export function moveObjectKey(
  key: string,
  destinationPrefix: string,
  folder: boolean
): string {
  const dest = normalizeObjectPrefix(destinationPrefix);
  const name = objectBaseName(key);
  if (folder) {
    return `${joinObjectKey(dest, name)}/`;
  }
  return joinObjectKey(dest, name);
}

export function validateFolderSegment(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Folder name is required.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Folder name is invalid.");
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    throw new Error("Folder name must not start with a slash.");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error("Folder name must not contain slashes.");
  }
  if (trimmed.includes("\0") || trimmed.split("/").includes("..")) {
    throw new Error("Folder name is invalid.");
  }
  return trimmed;
}
