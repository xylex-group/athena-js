const TEXT_ENCODER = new TextEncoder();

export interface PkceEnvelope {
	postAuthRedirect?: string;
	verifier: string;
}

async function aesGcmKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
	const material = await crypto.subtle.digest(
		"SHA-256",
		TEXT_ENCODER.encode(secret),
	);
	return crypto.subtle.importKey("raw", material, "AES-GCM", false, [usage]);
}

function parsePkceEnvelope(plain: string): PkceEnvelope {
	try {
		const parsed = JSON.parse(plain) as { r?: unknown; v?: unknown };
		if (typeof parsed.v === "string" && parsed.v.length > 0) {
			return {
				postAuthRedirect:
					typeof parsed.r === "string" && parsed.r.length > 0
						? parsed.r
						: undefined,
				verifier: parsed.v,
			};
		}
	} catch {
		// pre-envelope ciphertexts are the raw PKCE verifier
	}
	return { verifier: plain };
}

/** AES-GCM seal of the PKCE verifier for athena.oauth_transactions. */
export async function encryptPkceVerifier(
	verifier: string,
	secret: string,
	postAuthRedirect?: string,
): Promise<string> {
	const key = await aesGcmKey(secret, "encrypt");
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const payload = JSON.stringify({
		r: postAuthRedirect,
		v: verifier,
	});
	const cipher = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		TEXT_ENCODER.encode(payload),
	);
	const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
	packed.set(iv);
	packed.set(new Uint8Array(cipher), iv.byteLength);
	return Buffer.from(packed).toString("base64url");
}

export async function decryptPkcePlaintext(
	ciphertext: string,
	secret: string,
): Promise<string> {
	const packed = Buffer.from(ciphertext, "base64url");
	const iv = packed.subarray(0, 12);
	const data = packed.subarray(12);
	const key = await aesGcmKey(secret, "decrypt");
	const plain = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		data,
	);
	return new TextDecoder().decode(plain);
}

export async function openPkceEnvelope(
	ciphertext: string,
	secret: string,
): Promise<PkceEnvelope> {
	return parsePkceEnvelope(await decryptPkcePlaintext(ciphertext, secret));
}

export async function decryptPkceVerifier(
	ciphertext: string,
	secret: string,
): Promise<string> {
	return (await openPkceEnvelope(ciphertext, secret)).verifier;
}
