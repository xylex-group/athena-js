import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
	createPasskeyCredential,
	getPasskeyCredential,
} from "../src/auth/passkey/browser/ceremony.ts";
import { createPasskeyModule } from "../src/auth/passkey/client-module.ts";
import type { AthenaAuthResult } from "../src/auth/types.ts";

type CredentialRequest = {
	mediation?: CredentialMediationRequirement;
	publicKey?: PublicKeyCredentialRequestOptions;
	signal?: AbortSignal;
};

type CredentialCreate = {
	publicKey?: PublicKeyCredentialCreationOptions;
	signal?: AbortSignal;
};

function installBrowserWebAuthn(handlers: {
	create?: (options: CredentialCreate) => Promise<Credential | null>;
	get?: (options: CredentialRequest) => Promise<Credential | null>;
}): () => void {
	const previous = {
		navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
		PublicKeyCredential: Object.getOwnPropertyDescriptor(
			globalThis,
			"PublicKeyCredential",
		),
		window: Object.getOwnPropertyDescriptor(globalThis, "window"),
	};

	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { hostname: "localhost" } },
	});
	Object.defineProperty(globalThis, "PublicKeyCredential", {
		configurable: true,
		value: function PublicKeyCredential() {},
	});
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: {
			credentials: {
				create: (options: CredentialCreate) =>
					handlers.create ? handlers.create(options) : Promise.resolve(null),
				get: (options: CredentialRequest) =>
					handlers.get ? handlers.get(options) : Promise.resolve(null),
			},
		},
	});

	return () => {
		for (const [key, descriptor] of Object.entries(previous)) {
			if (descriptor) {
				Object.defineProperty(globalThis, key, descriptor);
			} else {
				Reflect.deleteProperty(globalThis, key);
			}
		}
	};
}

const emptyKey: PublicKeyCredentialRequestOptions = {
	challenge: new ArrayBuffer(8),
};

const emptyCreate: PublicKeyCredentialCreationOptions = {
	challenge: new ArrayBuffer(8),
	pubKeyCredParams: [],
	rp: { name: "Athena" },
	user: {
		displayName: "Ada",
		id: new ArrayBuffer(8),
		name: "ada@example.test",
	},
};

test("getPasskeyCredential forwards AbortSignal to credentials.get", async () => {
	const controller = new AbortController();
	let received: AbortSignal | undefined;
	const restore = installBrowserWebAuthn({
		get: async (options) => {
			received = options.signal;
			return null;
		},
	});
	try {
		await getPasskeyCredential(emptyKey, "conditional", controller.signal);
		assert.equal(received, controller.signal);
	} finally {
		restore();
	}
});

test("createPasskeyCredential forwards AbortSignal to credentials.create", async () => {
	const controller = new AbortController();
	let received: AbortSignal | undefined;
	const restore = installBrowserWebAuthn({
		create: async (options) => {
			received = options.signal;
			return null;
		},
	});
	try {
		await createPasskeyCredential(emptyCreate, controller.signal);
		assert.equal(received, controller.signal);
	} finally {
		restore();
	}
});

test("explicit sign-in aborts the conditional WebAuthn signal before the next get", async () => {
	const gets: CredentialRequest[] = [];
	const restore = installBrowserWebAuthn({
		get: async (options) => {
			gets.push(options);
			if (options.signal && gets.length === 1) {
				await new Promise<never>((_, reject) => {
					options.signal?.addEventListener("abort", () => {
						const error = new Error("The operation was aborted.");
						error.name = "AbortError";
						reject(error);
					});
				});
			}
			return {
				id: "cred",
				rawId: new ArrayBuffer(8),
				response: {
					authenticatorData: new ArrayBuffer(8),
					clientDataJSON: new ArrayBuffer(8),
					signature: new ArrayBuffer(8),
					userHandle: null,
				},
				type: "public-key",
			} as unknown as Credential;
		},
	});

	const optionsResult: AthenaAuthResult<{ challenge: string }> = {
		data: { challenge: "AQID" },
		error: null,
		ok: true,
		raw: {},
		status: 200,
	};
	const module = createPasskeyModule({
		capabilities: {
			passkeys: true,
			source: "client-config",
			status: "known",
		},
		request: async () => optionsResult as AthenaAuthResult<never>,
		sessionController: { accept: () => undefined },
	});

	const conditional = new AbortController();
	const pending = module.signIn({
		autoFill: true,
		fetchOptions: { signal: conditional.signal },
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(gets.length, 1);
	assert.equal(gets[0]?.mediation, "conditional");
	assert.equal(gets[0]?.signal?.aborted, false);

	conditional.abort();
	const explicit = new AbortController();
	await module.signIn({
		fetchOptions: { signal: explicit.signal },
	});

	assert.equal(gets[0]?.signal?.aborted, true);
	assert.equal(gets.length, 2);
	assert.equal(gets[1]?.mediation, "optional");
	assert.equal(gets[1]?.signal, explicit.signal);
	const cancelled = await pending;
	assert.equal(cancelled.ok, false);
	restore();
});

test("replacing a conditional ceremony leaves no live WebAuthn request", async () => {
	let live = 0;
	const restore = installBrowserWebAuthn({
		get: async (options) => {
			live += 1;
			await new Promise<never>((_, reject) => {
				options.signal?.addEventListener("abort", () => {
					live -= 1;
					const error = new Error("The operation was aborted.");
					error.name = "AbortError";
					reject(error);
				});
			});
		},
	});

	const optionsResult: AthenaAuthResult<{ challenge: string }> = {
		data: { challenge: "AQID" },
		error: null,
		ok: true,
		raw: {},
		status: 200,
	};
	const module = createPasskeyModule({
		capabilities: {
			passkeys: true,
			source: "client-config",
			status: "known",
		},
		request: async () => optionsResult as AthenaAuthResult<never>,
		sessionController: { accept: () => undefined },
	});

	const first = new AbortController();
	const pending = module.signIn({
		autoFill: true,
		fetchOptions: { signal: first.signal },
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(live, 1);
	first.abort();
	await pending;
	assert.equal(live, 0);
	restore();
});
