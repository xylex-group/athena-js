const REDACTED = "[REDACTED]";
const CIRCULAR = "[Circular]";
const TRUNCATED = "[Truncated]";

export const EXTERNAL_DIAGNOSTIC_BUDGET = {
  maxArrayEntries: 32,
  maxDepth: 6,
  maxObjectKeys: 32,
  maxStringBytes: 2_048,
  maxTotalBytes: 16_384,
} as const;

const REDACTED_KEY = /authorization|api[_-]?key|password|secret|token/i;

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) {
    return value;
  }
  return `${new TextDecoder().decode(bytes.slice(0, maxBytes))}${TRUNCATED}`;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  active: WeakSet<object>
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return truncateUtf8(value, EXTERNAL_DIAGNOSTIC_BUDGET.maxStringBytes);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "undefined") {
    return "[Undefined]";
  }
  if (typeof value === "function") {
    return "[Function]";
  }
  if (typeof value === "symbol") {
    return "[Symbol]";
  }
  if (depth >= EXTERNAL_DIAGNOSTIC_BUDGET.maxDepth) {
    return TRUNCATED;
  }
  if (active.has(value)) {
    return CIRCULAR;
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const result = value
        .slice(0, EXTERNAL_DIAGNOSTIC_BUDGET.maxArrayEntries)
        .map((entry) => sanitizeValue(entry, depth + 1, active));
      if (value.length > EXTERNAL_DIAGNOSTIC_BUDGET.maxArrayEntries) {
        result.push(TRUNCATED);
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    for (const key of keys.slice(0, EXTERNAL_DIAGNOSTIC_BUDGET.maxObjectKeys)) {
      if (REDACTED_KEY.test(key)) {
        result[key] = REDACTED;
        continue;
      }
      const descriptor = descriptors[key];
      if (descriptor == null || !("value" in descriptor)) {
        result[key] = "[Unavailable]";
        continue;
      }
      result[key] = sanitizeValue(descriptor.value, depth + 1, active);
    }
    if (keys.length > EXTERNAL_DIAGNOSTIC_BUDGET.maxObjectKeys) {
      result[TRUNCATED] = keys.length - EXTERNAL_DIAGNOSTIC_BUDGET.maxObjectKeys;
    }
    return result;
  } finally {
    active.delete(value);
  }
}

export function sanitizeExternalDiagnostic(value: unknown): unknown {
  const sanitized = sanitizeValue(value, 0, new WeakSet<object>());
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    return TRUNCATED;
  }
  if (new TextEncoder().encode(serialized).byteLength <= EXTERNAL_DIAGNOSTIC_BUDGET.maxTotalBytes) {
    return sanitized;
  }
  return TRUNCATED;
}
