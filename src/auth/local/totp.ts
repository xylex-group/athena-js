const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const index = BASE32.indexOf(char);
    if (index < 0) {
      continue;
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

function writeUint64(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = Math.floor(counter);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = remaining & 255;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toBufferSource(key),
    { hash: "SHA-1", name: "HMAC" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, toBufferSource(data))
  );
}

export async function generateTotpCode(
  secret: Uint8Array,
  options?: { digits?: number; period?: number; timestamp?: number }
): Promise<string> {
  const digits = options?.digits ?? 6;
  const period = options?.period ?? 30;
  const counter = Math.floor((options?.timestamp ?? Date.now()) / 1000 / period);
  const digest = await hmacSha1(secret, writeUint64(counter));
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary =
    (((digest[offset] ?? 0) & 127) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

export async function verifyTotpCode(
  secret: Uint8Array,
  code: string,
  options?: { digits?: number; period?: number; window?: number }
): Promise<boolean> {
  const normalized = code.replace(/\s+/g, "");
  const window = options?.window ?? 1;
  const now = Date.now();
  for (let step = -window; step <= window; step += 1) {
    const expected = await generateTotpCode(secret, {
      digits: options?.digits,
      period: options?.period,
      timestamp: now + step * (options?.period ?? 30) * 1000,
    });
    if (expected === normalized) {
      return true;
    }
  }
  return false;
}

export function buildTotpUri(input: {
  account: string;
  issuer?: string;
  period?: number;
  secret: string;
}): string {
  const issuer = input.issuer ?? "AthenaAuth";
  const label = encodeURIComponent(`${issuer}:${input.account}`);
  const params = new URLSearchParams({
    digits: "6",
    issuer,
    period: String(input.period ?? 30),
    secret: input.secret,
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateTotpSecret(): { encoded: string; raw: Uint8Array } {
  const raw = crypto.getRandomValues(new Uint8Array(20));
  return { encoded: encodeBase32(raw), raw };
}
