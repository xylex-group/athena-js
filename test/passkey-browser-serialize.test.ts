import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  serializeAssertedPasskey,
  serializeAuthenticationCredential,
  serializeCreatedPasskey,
  serializeRegistrationCredential,
} from "../src/auth/passkey/browser/serialize.ts";

const serializeSrc = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "auth",
    "passkey",
    "browser",
    "serialize.ts"
  ),
  "utf8"
);

class TestAuthenticatorAttestationResponse {
  clientDataJSON: ArrayBuffer;
  attestationObject: ArrayBuffer;
  constructor(input: {
    attestationObject: ArrayBuffer;
    clientDataJSON: ArrayBuffer;
  }) {
    this.attestationObject = input.attestationObject;
    this.clientDataJSON = input.clientDataJSON;
  }
  getTransports(): AuthenticatorTransport[] {
    return ["internal"];
  }
}

class TestAuthenticatorAssertionResponse {
  authenticatorData: ArrayBuffer;
  clientDataJSON: ArrayBuffer;
  signature: ArrayBuffer;
  userHandle: ArrayBuffer | null;
  constructor(input: {
    authenticatorData: ArrayBuffer;
    clientDataJSON: ArrayBuffer;
    signature: ArrayBuffer;
    userHandle: ArrayBuffer | null;
  }) {
    this.authenticatorData = input.authenticatorData;
    this.clientDataJSON = input.clientDataJSON;
    this.signature = input.signature;
    this.userHandle = input.userHandle;
  }
}

class TestPublicKeyCredential {
  id: string;
  rawId: ArrayBuffer;
  type = "public-key" as const;
  authenticatorAttachment: AuthenticatorAttachment | null;
  response:
    | TestAuthenticatorAssertionResponse
    | TestAuthenticatorAttestationResponse;
  #extensions: AuthenticationExtensionsClientOutputs;
  constructor(input: {
    authenticatorAttachment?: AuthenticatorAttachment | null;
    extensions?: AuthenticationExtensionsClientOutputs;
    id: string;
    rawId: ArrayBuffer;
    response:
      | TestAuthenticatorAssertionResponse
      | TestAuthenticatorAttestationResponse;
  }) {
    this.authenticatorAttachment = input.authenticatorAttachment ?? null;
    this.id = input.id;
    this.rawId = input.rawId;
    this.response = input.response;
    this.#extensions = input.extensions ?? {};
  }
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs {
    return this.#extensions;
  }
}

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function installWebAuthnCtors(): () => void {
  const previous = {
    AuthenticatorAssertionResponse: Object.getOwnPropertyDescriptor(
      globalThis,
      "AuthenticatorAssertionResponse"
    ),
    AuthenticatorAttestationResponse: Object.getOwnPropertyDescriptor(
      globalThis,
      "AuthenticatorAttestationResponse"
    ),
    PublicKeyCredential: Object.getOwnPropertyDescriptor(
      globalThis,
      "PublicKeyCredential"
    ),
  };
  Object.defineProperty(globalThis, "AuthenticatorAssertionResponse", {
    configurable: true,
    value: TestAuthenticatorAssertionResponse,
  });
  Object.defineProperty(globalThis, "AuthenticatorAttestationResponse", {
    configurable: true,
    value: TestAuthenticatorAttestationResponse,
  });
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: TestPublicKeyCredential,
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

test("passkey serializer source does not walk arbitrary WebAuthn objects", () => {
  assert.equal(serializeSrc.includes("serializeWebAuthnValue"), false);
  assert.equal(serializeSrc.includes("toJSON"), false);
  assert.equal(serializeSrc.includes("Object.entries"), false);
  assert.equal(serializeSrc.includes("Object.fromEntries"), false);
});

test("serializeAuthenticationCredential copies only the Athena assertion wire", () => {
  const restore = installWebAuthnCtors();
  try {
    const cyclic: Record<string, unknown> = { extra: "nordpass-extension" };
    cyclic.self = cyclic;
    cyclic.toJSON = () => cyclic;

    const credential = new TestPublicKeyCredential({
      authenticatorAttachment: "platform",
      extensions: cyclic as AuthenticationExtensionsClientOutputs,
      id: "cred-id",
      rawId: bytes([1, 2, 3]),
      response: new TestAuthenticatorAssertionResponse({
        authenticatorData: bytes([4, 5]),
        clientDataJSON: bytes([6, 7, 8]),
        signature: bytes([9, 10, 11, 12]),
        userHandle: bytes([13]),
      }),
    });
    (credential as unknown as { extraNativeGraph: unknown }).extraNativeGraph =
      cyclic;

    const wire = serializeAuthenticationCredential(credential);
    assert.deepEqual(wire, {
      authenticatorAttachment: "platform",
      id: "cred-id",
      rawId: "AQID",
      response: {
        authenticatorData: "BAU",
        clientDataJSON: "BgcI",
        signature: "CQoLDA",
        userHandle: "DQ",
      },
      type: "public-key",
    });
    assert.equal("clientExtensionResults" in wire, false);
    assert.doesNotThrow(() => serializeAssertedPasskey(credential));
  } finally {
    restore();
  }
});

test("serializeRegistrationCredential copies known fields and credProps only", () => {
  const restore = installWebAuthnCtors();
  try {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    cyclic.toJSON = () => cyclic;

    const credential = new TestPublicKeyCredential({
      authenticatorAttachment: "cross-platform",
      extensions: {
        credProps: { rk: true },
        prf: cyclic,
      } as AuthenticationExtensionsClientOutputs,
      id: "reg-id",
      rawId: bytes([1]),
      response: new TestAuthenticatorAttestationResponse({
        attestationObject: bytes([2, 3]),
        clientDataJSON: bytes([4]),
      }),
    });

    const wire = serializeRegistrationCredential(credential);
    assert.deepEqual(wire, {
      authenticatorAttachment: "cross-platform",
      clientExtensionResults: { credProps: { rk: true } },
      id: "reg-id",
      rawId: "AQ",
      response: {
        attestationObject: "AgM",
        clientDataJSON: "BA",
        transports: ["internal"],
      },
      type: "public-key",
    });
    assert.doesNotThrow(() => serializeCreatedPasskey(credential));
  } finally {
    restore();
  }
});
