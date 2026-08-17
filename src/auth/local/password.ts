import {
  ATHENA_AUTH_DEFAULT_ARGON2,
  type AthenaAuthArgon2Params,
} from "../contract/index.ts";
import { AthenaAuthRuntimeError } from "./errors.ts";

export interface AthenaAuthPasswordHasher {
  hash(password: string): Promise<string>;
  needsRehash(hash: string): boolean;
  verify(password: string, hash: string): Promise<boolean>;
}

const PHC_B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodePhcBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const remaining = bytes.length - index;
    const a = bytes[index] ?? 0;
    const b = remaining > 1 ? (bytes[index + 1] ?? 0) : 0;
    const c = remaining > 2 ? (bytes[index + 2] ?? 0) : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += PHC_B64[(triple >> 18) & 63];
    output += PHC_B64[(triple >> 12) & 63];
    if (remaining > 1) {
      output += PHC_B64[(triple >> 6) & 63];
    }
    if (remaining > 2) {
      output += PHC_B64[triple & 63];
    }
  }
  return output;
}

function decodePhcBase64(value: string): Uint8Array {
  const cleaned = value.replace(/=+$/g, "");
  const output: number[] = [];
  for (let index = 0; index < cleaned.length; index += 4) {
    const chunk = cleaned.slice(index, index + 4);
    const values = [...chunk].map((char) => {
      const decoded = PHC_B64.indexOf(char);
      if (decoded < 0) {
        throw new Error("Invalid PHC base64");
      }
      return decoded;
    });
    const a = values[0] ?? 0;
    const b = values[1] ?? 0;
    const c = values[2] ?? 0;
    const d = values[3] ?? 0;
    output.push(((a << 2) | (b >> 4)) & 255);
    if (chunk.length > 2) {
      output.push(((b << 4) | (c >> 2)) & 255);
    }
    if (chunk.length > 3) {
      output.push(((c << 6) | d) & 255);
    }
  }
  return Uint8Array.from(output);
}

function parsePhcDecimal(hash: string, key: string): number | undefined {
  const match = new RegExp(`(?:^|[,$?])${key}=(\\d+)`).exec(hash);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1] ?? "", 10);
}

export function parseArgon2Phc(hash: string): {
  hash: Uint8Array;
  memoryCost: number;
  parallelism: number;
  salt: Uint8Array;
  timeCost: number;
} | undefined {
  const match =
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      hash
    );
  if (!match) {
    return undefined;
  }
  return {
    hash: decodePhcBase64(match[5] ?? ""),
    memoryCost: Number.parseInt(match[1] ?? "", 10),
    parallelism: Number.parseInt(match[3] ?? "1", 10),
    salt: decodePhcBase64(match[4] ?? ""),
    timeCost: Number.parseInt(match[2] ?? "", 10),
  };
}

export function passwordHashNeedsRehash(
  hash: string,
  params: AthenaAuthArgon2Params = ATHENA_AUTH_DEFAULT_ARGON2
): boolean {
  const memoryCost = parsePhcDecimal(hash, "m");
  const timeCost = parsePhcDecimal(hash, "t");
  const parallelism = parsePhcDecimal(hash, "p");
  if (
    memoryCost === undefined ||
    timeCost === undefined ||
    parallelism === undefined
  ) {
    return false;
  }
  // Monotonic upgrade only — never rehash a stronger stored profile down.
  return (
    memoryCost < params.memoryCost ||
    timeCost < params.timeCost ||
    parallelism < params.parallelism
  );
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function loadNobleArgon2(): Promise<{
  argon2id: (
    password: Uint8Array,
    salt: Uint8Array,
    options: { dkLen: number; m: number; p: number; t: number }
  ) => Uint8Array;
}> {
  const importer = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<{
    argon2id: (
      password: Uint8Array,
      salt: Uint8Array,
      options: { dkLen: number; m: number; p: number; t: number }
    ) => Uint8Array;
  }>;
  return importer("@noble/hashes/argon2.js");
}

async function argon2idDigest(
  password: string,
  salt: Uint8Array,
  params: { dkLen: number; memoryCost: number; parallelism: number; timeCost: number }
): Promise<Uint8Array> {
  const module = await loadNobleArgon2();
  return module.argon2id(encodeUtf8(password), salt, {
    dkLen: params.dkLen,
    m: params.memoryCost,
    p: params.parallelism,
    t: params.timeCost,
  });
}

export function createArgon2PasswordHasher(
  params: AthenaAuthArgon2Params = ATHENA_AUTH_DEFAULT_ARGON2
): AthenaAuthPasswordHasher {
  return {
    async hash(password: string): Promise<string> {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const digest = await argon2idDigest(password, salt, {
        dkLen: 32,
        memoryCost: params.memoryCost,
        parallelism: params.parallelism,
        timeCost: params.timeCost,
      });
      return `$argon2id$v=19$m=${params.memoryCost},t=${params.timeCost},p=${params.parallelism}$${encodePhcBase64(salt)}$${encodePhcBase64(digest)}`;
    },
    needsRehash(hash: string): boolean {
      return passwordHashNeedsRehash(hash, params);
    },
    async verify(password: string, hash: string): Promise<boolean> {
      const parsed = parseArgon2Phc(hash);
      if (!parsed) {
        return false;
      }
      const digest = await argon2idDigest(password, parsed.salt, {
        dkLen: parsed.hash.length,
        memoryCost: parsed.memoryCost,
        parallelism: parsed.parallelism,
        timeCost: parsed.timeCost,
      });
      return timingSafeEqual(digest, parsed.hash);
    },
  };
}

export function validatePassword(
  password: string,
  options: { maxLength: number; minLength: number }
): void {
  if (password.length < options.minLength) {
    throw AthenaAuthRuntimeError.badRequest(
      `Password must be at least ${options.minLength} characters long`
    );
  }
  if (password.length > options.maxLength) {
    throw AthenaAuthRuntimeError.badRequest(
      `Password must be at most ${options.maxLength} characters long`
    );
  }
}

export function extractPasswordHash(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const value = (metadata as Record<string, unknown>).password_hash;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function withPasswordHash(
  metadata: Record<string, unknown> | undefined,
  hash: string
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    password_hash: hash,
  };
}
