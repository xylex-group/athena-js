import {
  decodeBase64UrlToString,
  encodeBytesToBase64Url,
  encodeStringToBase64Url,
} from "./base64.ts";

type JwtPayload = Record<string, unknown>;

const HS256_ALG = "HS256";

interface SubtleCryptoLike {
  importKey: (
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    keyUsages: Array<"sign" | "verify">
  ) => Promise<unknown>;
  sign: (
    algorithm: "HMAC",
    key: unknown,
    data: Uint8Array
  ) => Promise<ArrayBuffer>;
}

interface WebCryptoLike {
  subtle?: SubtleCryptoLike;
}

async function getSubtleCrypto(): Promise<SubtleCryptoLike> {
  const globalCrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (globalCrypto?.subtle) {
    return globalCrypto.subtle;
  }
  const { webcrypto } = await import("node:crypto");
  const subtle = (webcrypto as unknown as WebCryptoLike).subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle API is unavailable.");
  }
  return subtle;
}

async function importHmacKey(
  secret: string,
  usage: "sign" | "verify"
): Promise<unknown> {
  const subtle = await getSubtleCrypto();
  return subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      hash: "SHA-256",
      name: "HMAC",
    },
    false,
    [usage] as Array<"sign" | "verify">
  );
}

function bufferToBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function parseJwtPayload(payloadSegment: string): JwtPayload | null {
  try {
    const decoded = decodeBase64UrlToString(payloadSegment);
    const payload = JSON.parse(decoded) as unknown;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

function isJwtExpired(payload: JwtPayload): boolean {
  const exp = payload.exp;
  if (typeof exp !== "number") {
    return false;
  }
  return exp < Math.floor(Date.now() / 1000);
}

export async function signHmacBase64Url(
  secret: string,
  value: string
): Promise<string> {
  const subtle = await getSubtleCrypto();
  const key = await importHmacKey(secret, "sign");
  const signature = await subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return encodeBytesToBase64Url(bufferToBytes(signature));
}

export async function signJwtHS256(
  payload: JwtPayload,
  secret: string,
  expiresIn = 60 * 5
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: HS256_ALG, typ: "JWT" };
  const fullPayload = {
    ...payload,
    exp: now + expiresIn,
    iat: now,
  };
  const headerPart = encodeStringToBase64Url(JSON.stringify(header));
  const payloadPart = encodeStringToBase64Url(JSON.stringify(fullPayload));
  const message = `${headerPart}.${payloadPart}`;
  const signature = await signHmacBase64Url(secret, message);
  return `${message}.${signature}`;
}

export async function verifyJwtHS256<TPayload extends JwtPayload = JwtPayload>(
  token: string,
  secret: string
): Promise<TPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!(headerPart && payloadPart && signaturePart)) {
    return null;
  }

  let header: { alg?: string } | null = null;
  try {
    header = JSON.parse(decodeBase64UrlToString(headerPart)) as {
      alg?: string;
    };
  } catch {
    return null;
  }

  if (!header || header.alg !== HS256_ALG) {
    return null;
  }

  const payload = parseJwtPayload(payloadPart);
  if (!payload) {
    return null;
  }

  const expectedSignature = await signHmacBase64Url(
    secret,
    `${headerPart}.${payloadPart}`
  );
  if (expectedSignature !== signaturePart) {
    return null;
  }

  if (isJwtExpired(payload)) {
    return null;
  }

  return payload as TPayload;
}
