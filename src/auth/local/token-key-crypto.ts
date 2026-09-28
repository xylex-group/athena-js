const TEXT_ENCODER = new TextEncoder();

async function aesGcmKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    TEXT_ENCODER.encode(secret)
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [usage]);
}

export async function sealTokenPrivateJwk(
  privateJwk: Record<string, unknown>,
  secret: string
): Promise<string> {
  const key = await aesGcmKey(secret, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    TEXT_ENCODER.encode(JSON.stringify(privateJwk))
  );
  const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(cipher), iv.byteLength);
  return Buffer.from(packed).toString("base64url");
}

export async function openTokenPrivateJwk(
  ciphertext: string,
  secret: string
): Promise<Record<string, unknown>> {
  const packed = Buffer.from(ciphertext, "base64url");
  const iv = packed.subarray(0, 12);
  const data = packed.subarray(12);
  const key = await aesGcmKey(secret, "decrypt");
  const plain = await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, key, data);
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
}

export function issuerAdvisoryLockKey(issuer: string): number {
  let hash = 0;
  for (let index = 0; index < issuer.length; index += 1) {
    hash = (hash * 31 + issuer.charCodeAt(index)) | 0;
  }
  return hash === 0 ? 1 : hash;
}
