/**
 * Single Athena identity protocol for query keys, entity IDs, fingerprints,
 * mutation keys, SSR snapshots, and MCP descriptors.
 */

const TYPE_NULL = "null";
const TYPE_UNDEFINED = "undefined";
const TYPE_STRING = "s";
const TYPE_NUMBER = "n";
const TYPE_BOOLEAN = "b";
const TYPE_BIGINT = "bi";
const TYPE_DATE = "date";
const TYPE_ARRAY = "array";
const TYPE_OBJECT = "object";
const TYPE_MAP = "map";
const TYPE_SET = "set";
const TYPE_BYTES = "bytes";
const TYPE_CIRCULAR = "circular";

function escapeTag(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function canonicalizeAthenaValue(
  value: unknown,
  seen = new WeakSet<object>()
): string {
  if (value === null) {
    return TYPE_NULL;
  }
  if (value === undefined) {
    return TYPE_UNDEFINED;
  }

  const valueType = typeof value;
  if (valueType === "string") {
    return `${TYPE_STRING}:"${escapeTag(value as string)}"`;
  }
  if (valueType === "boolean") {
    return `${TYPE_BOOLEAN}:${value ? "true" : "false"}`;
  }
  if (valueType === "number") {
    if (Number.isNaN(value)) {
      return `${TYPE_NUMBER}:NaN`;
    }
    if (value === Number.POSITIVE_INFINITY) {
      return `${TYPE_NUMBER}:Infinity`;
    }
    if (value === Number.NEGATIVE_INFINITY) {
      return `${TYPE_NUMBER}:-Infinity`;
    }
    return `${TYPE_NUMBER}:${value}`;
  }
  if (valueType === "bigint") {
    return `${TYPE_BIGINT}:${value.toString()}`;
  }
  if (valueType === "symbol") {
    return `symbol:${escapeTag(String((value as symbol).description ?? ""))}`;
  }
  if (valueType === "function") {
    const named = value as { name?: string };
    return `function:${escapeTag(named.name || "anonymous")}`;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time)
      ? `${TYPE_DATE}:Invalid`
      : `${TYPE_DATE}:${value.toISOString()}`;
  }

  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    return `${TYPE_BYTES}:${arrayBufferToHex(value)}`;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return `${TYPE_BYTES}:${[...copy].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    return TYPE_CIRCULAR;
  }
  seen.add(objectValue);

  try {
    if (value instanceof Map) {
      const entries = [...value.entries()]
        .map(
          ([key, item]) =>
            `[${canonicalizeAthenaValue(key, seen)},${canonicalizeAthenaValue(item, seen)}]`
        )
        .sort((left, right) => left.localeCompare(right));
      return `${TYPE_MAP}:[${entries.join(",")}]`;
    }
    if (value instanceof Set) {
      const items = [...value]
        .map((item) => canonicalizeAthenaValue(item, seen))
        .sort((left, right) => left.localeCompare(right));
      return `${TYPE_SET}:[${items.join(",")}]`;
    }
    if (Array.isArray(value)) {
      return `${TYPE_ARRAY}:[${value
        .map((item) => canonicalizeAthenaValue(item, seen))
        .join(",")}]`;
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) =>
      left.localeCompare(right)
    );
    const fields = keys.map(
      (key) =>
        `${TYPE_STRING}:"${escapeTag(key)}":${canonicalizeAthenaValue(record[key], seen)}`
    );
    return `${TYPE_OBJECT}:{${fields.join(",")}}`;
  } finally {
    seen.delete(objectValue);
  }
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** FNV-1a 32-bit over the canonical form. Deterministic across runtimes. */
export function hashAthenaValue(value: unknown): string {
  const canonical = canonicalizeAthenaValue(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
