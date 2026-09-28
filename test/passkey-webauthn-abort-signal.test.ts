import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  createPasskeyCredential,
  getPasskeyCredential,
  isAlreadyPendingWebAuthnError,
  resetWebAuthnCeremonyLockForTests,
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

class FakeAuthenticatorAssertionResponse {
  authenticatorData = new ArrayBuffer(8);
  clientDataJSON = new ArrayBuffer(8);
  signature = new ArrayBuffer(8);
  userHandle: ArrayBuffer | null = null;
}

class FakePublicKeyCredential {
  id = "cred";
  rawId = new ArrayBuffer(8);
  type = "public-key" as const;
  authenticatorAttachment: AuthenticatorAttachment | null = null;
  response = new FakeAuthenticatorAssertionResponse();
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs {
    return {};
  }
}

function fakeAssertedPasskey(): Credential {
  return new FakePublicKeyCredential() as unknown as Credential;
}

function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function alreadyPendingError(): Error {
  const error = new Error("A request is already pending.");
  error.name = "InvalidStateError";
  return error;
}

function installBrowserWebAuthn(handlers: {
  create?: (options: CredentialCreate) => Promise<Credential | null>;
  get?: (options: CredentialRequest) => Promise<Credential | null>;
}): () => void {
  resetWebAuthnCeremonyLockForTests();
  const previous = {
    AuthenticatorAssertionResponse: Object.getOwnPropertyDescriptor(
      globalThis,
      "AuthenticatorAssertionResponse"
    ),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    PublicKeyCredential: Object.getOwnPropertyDescriptor(
      globalThis,
      "PublicKeyCredential"
    ),
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { hostname: "localhost" } },
  });
  Object.defineProperty(globalThis, "AuthenticatorAssertionResponse", {
    configurable: true,
    value: FakeAuthenticatorAssertionResponse,
  });
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: FakePublicKeyCredential,
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
    resetWebAuthnCeremonyLockForTests();
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

function createSignInModule() {
  const optionsResult: AthenaAuthResult<{ challenge: string }> = {
    data: { challenge: "AQID" },
    error: null,
    ok: true,
    raw: {},
    status: 200,
  };
  return createPasskeyModule({
    capabilities: {
      passkeys: true,
      source: "client-config",
      status: "known",
    },
    request: async () => optionsResult as AthenaAuthResult<never>,
    sessionController: { accept: () => undefined },
  });
}

test("getPasskeyCredential aborts the owned WebAuthn signal when the caller aborts", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const restore = installBrowserWebAuthn({
    get: async (options) => {
      received = options.signal;
      await new Promise<never>((_, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(abortError());
        });
      });
    },
  });
  try {
    const pending = getPasskeyCredential(
      emptyKey,
      "conditional",
      controller.signal
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(received?.aborted, false);
    controller.abort();
    assert.equal(received?.aborted, true);
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
  } finally {
    restore();
  }
});

test("createPasskeyCredential aborts the owned WebAuthn signal when the caller aborts", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const restore = installBrowserWebAuthn({
    create: async (options) => {
      received = options.signal;
      await new Promise<never>((_, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(abortError());
        });
      });
    },
  });
  try {
    const pending = createPasskeyCredential(emptyCreate, controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    assert.equal(received?.aborted, true);
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
  } finally {
    restore();
  }
});

test("explicit sign-in waits for the aborted conditional get to settle before a new get", async () => {
  const gets: CredentialRequest[] = [];
  let live = 0;
  const restore = installBrowserWebAuthn({
    get: async (options) => {
      live += 1;
      gets.push(options);
      if (gets.length === 1) {
        await new Promise<never>((_, reject) => {
          options.signal?.addEventListener("abort", () => {
            setTimeout(() => {
              live -= 1;
              reject(abortError());
            }, 25);
          });
        });
      }
      live -= 1;
      return fakeAssertedPasskey();
    },
  });

  const module = createSignInModule();

  try {
    const conditional = new AbortController();
    const pending = module.signIn({
      autoFill: true,
      fetchOptions: { signal: conditional.signal },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(gets.length, 1);
    assert.equal(live, 1);
    assert.equal(gets[0]?.mediation, "conditional");

    conditional.abort();
    const explicitStarted = module.signIn({
      fetchOptions: { signal: new AbortController().signal },
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(gets.length, 1);
    assert.equal(live, 1);

    await explicitStarted;
    assert.equal(live, 0);
    assert.equal(gets.length, 2);
    assert.equal(gets[1]?.mediation, "optional");
    assert.notEqual(gets[1]?.signal, gets[0]?.signal);

    const cancelled = await pending;
    assert.equal(cancelled.ok, false);
  } finally {
    restore();
  }
});

test("a second get never overlaps a live first get", async () => {
  let live = 0;
  let maxLive = 0;
  let getCount = 0;
  const restore = installBrowserWebAuthn({
    get: async (options) => {
      getCount += 1;
      live += 1;
      maxLive = Math.max(maxLive, live);
      if (getCount === 1) {
        await new Promise<never>((_, reject) => {
          options.signal?.addEventListener("abort", () => {
            setTimeout(() => {
              live -= 1;
              reject(abortError());
            }, 10);
          });
        });
      }
      live -= 1;
      return fakeAssertedPasskey();
    },
  });

  try {
    const first = new AbortController();
    const pendingFirst = getPasskeyCredential(
      emptyKey,
      "conditional",
      first.signal
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(live, 1);

    const pendingSecond = getPasskeyCredential(
      emptyKey,
      "optional",
      new AbortController().signal
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(maxLive, 1);

    await assert.rejects(pendingFirst);
    await pendingSecond;
    assert.equal(maxLive, 1);
    assert.equal(getCount, 2);
  } finally {
    restore();
  }
});

test("already-pending browser errors are treated as abort/cancellation", async () => {
  assert.equal(isAlreadyPendingWebAuthnError(alreadyPendingError()), true);
  const restore = installBrowserWebAuthn({
    get: async () => {
      throw alreadyPendingError();
    },
  });
  try {
    await assert.rejects(
      getPasskeyCredential(emptyKey, "optional"),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "AbortError" &&
        error.cause instanceof Error &&
        isAlreadyPendingWebAuthnError(error.cause)
    );
  } finally {
    restore();
  }
});

test("replacing a conditional ceremony leaves no live WebAuthn request", async () => {
  let live = 0;
  const restore = installBrowserWebAuthn({
    get: async (options) => {
      live += 1;
      await new Promise<never>((_, reject) => {
        options.signal?.addEventListener("abort", () => {
          live -= 1;
          reject(abortError());
        });
      });
    },
  });

  const module = createSignInModule();

  try {
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
  } finally {
    restore();
  }
});
