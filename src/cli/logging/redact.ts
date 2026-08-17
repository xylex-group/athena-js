export function redactSecrets(input: string): string {
  let output = input;
  // postgresql://user:password@host → keep user, mask password
  output = output.replace(
    /(postgres(?:ql)?:\/\/[^:/\s]+):([^@/\s]+)@/gi,
    "$1:***@"
  );
  output = output.replace(/(authorization\s*:\s*bearer\s+)\S+/gi, "$1***");
  output = output.replace(/(ATHENA_API_KEY\s*[=:]\s*)\S+/gi, "$1***");
  output = output.replace(/(api[_-]?key\s*[=:]\s*)\S+/gi, "$1***");
  output = output.replace(/(cookie\s*[=:]\s*)[^\n;]+/gi, "$1***");
  output = output.replace(/(password\s*[=:]\s*)\S+/gi, "$1***");
  output = output.replace(/(secret\s*[=:]\s*)\S+/gi, "$1***");
  return output;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/password|secret|token|authorization|cookie|api.?key/i.test(key)) {
        out[key] = "***";
      } else {
        out[key] = redactValue(nested);
      }
    }
    return out;
  }
  return value;
}
