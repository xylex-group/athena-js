function getAtob(): ((input: string) => string) | undefined {
  const candidate = (globalThis as { atob?: unknown }).atob;
  return typeof candidate === "function"
    ? (candidate as (input: string) => string)
    : undefined;
}

function getBtoa(): ((input: string) => string) | undefined {
  const candidate = (globalThis as { btoa?: unknown }).btoa;
  return typeof candidate === "function"
    ? (candidate as (input: string) => string)
    : undefined;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  const btoaFn = getBtoa();
  if (btoaFn) {
    return btoaFn(bytesToBinaryString(bytes));
  }
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(base64: string): Uint8Array {
  const atobFn = getAtob();
  if (atobFn) {
    return binaryStringToBytes(atobFn(base64));
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export function encodeBytesToBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
}

export function encodeStringToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return encodeBytesToBase64Url(bytes);
}

export function decodeBase64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = normalized.length % 4;
  const padded =
    paddingLength === 0
      ? normalized
      : `${normalized}${"=".repeat(4 - paddingLength)}`;
  return decodeBase64(padded);
}

export function decodeBase64UrlToString(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlToBytes(value));
}
