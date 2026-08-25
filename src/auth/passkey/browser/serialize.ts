function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
}

function serializeWebAuthnValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return toBase64Url(new Uint8Array(value));
  }

  if (ArrayBuffer.isView(value)) {
    return toBase64Url(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeWebAuthnValue(item));
  }

  if (
    value &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof (value as { toJSON?: unknown }).toJSON === "function"
  ) {
    const jsonValue = (value as { toJSON: () => unknown }).toJSON();
    if (jsonValue !== value) {
      return serializeWebAuthnValue(jsonValue);
    }
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        serializeWebAuthnValue(nested),
      ])
    );
  }

  return value;
}

/** Browser never verifies (PASSKEY-I3) — serialize only for the HTTP verify body. */
export function serializeRegistrationCredential(credential: unknown): unknown {
  return serializeWebAuthnValue(credential);
}

export function serializeAuthenticationCredential(credential: unknown): unknown {
  return serializeWebAuthnValue(credential);
}
