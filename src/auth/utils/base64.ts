function toUint8Array(input: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  return new Uint8Array(input);
}

function bytesToBase64(
  bytes: Uint8Array,
  urlSafe: boolean,
  padding: boolean
): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  let encoded = btoa(binary);
  if (urlSafe) {
    encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_");
  }
  if (!padding) {
    encoded = encoded.replace(/[=]+$/g, "");
  }
  return encoded;
}

/**
 * Standard Base64 helpers (RFC 4648) used for HTTP Basic Auth credentials.
 */
export const base64 = {
  encode(input: string | ArrayBuffer | Uint8Array): string {
    return bytesToBase64(toUint8Array(input), false, true);
  },
};

/**
 * Base64URL helpers used for PKCE code challenges.
 */
export const base64Url = {
  encode(
    input: string | ArrayBuffer | Uint8Array,
    options?: { padding?: boolean }
  ): string {
    return bytesToBase64(toUint8Array(input), true, options?.padding !== false);
  },
};
