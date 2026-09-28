export interface AthenaPasskeyAuthenticationWire {
  authenticatorAttachment?: AuthenticatorAttachment;
  id: string;
  rawId: string;
  response: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    userHandle: string | null;
  };
  type: "public-key";
}

export interface AthenaPasskeyRegistrationWire {
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: {
    credProps?: { rk: boolean };
  };
  id: string;
  rawId: string;
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports?: string[];
  };
  type: "public-key";
}

type GlobalWebAuthn = typeof globalThis & {
  AuthenticatorAssertionResponse?: typeof AuthenticatorAssertionResponse;
  AuthenticatorAttestationResponse?: typeof AuthenticatorAttestationResponse;
  PublicKeyCredential?: typeof PublicKeyCredential;
};

function toBase64Url(value: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
}

function requirePublicKeyCredential(value: unknown): PublicKeyCredential {
  const CredentialCtor = (globalThis as GlobalWebAuthn).PublicKeyCredential;
  if (!(CredentialCtor && value instanceof CredentialCtor)) {
    throw new TypeError("Expected a PublicKeyCredential returned by WebAuthn");
  }
  return value;
}

function authenticatorAttachmentOf(
  credential: PublicKeyCredential
): AuthenticatorAttachment | undefined {
  const attachment = credential.authenticatorAttachment;
  if (attachment === "platform" || attachment === "cross-platform") {
    return attachment;
  }
}

function registrationExtensionResults(
  credential: PublicKeyCredential
): AthenaPasskeyRegistrationWire["clientExtensionResults"] {
  const results = credential.getClientExtensionResults();
  const credProps = results.credProps;
  if (!credProps || typeof credProps !== "object") {
    return {};
  }
  const rk = (credProps as { rk?: unknown }).rk;
  if (typeof rk !== "boolean") {
    return {};
  }
  return { credProps: { rk } };
}

export function serializeRegistrationCredential(
  value: unknown
): AthenaPasskeyRegistrationWire {
  const credential = requirePublicKeyCredential(value);
  const AttestationCtor = (globalThis as GlobalWebAuthn)
    .AuthenticatorAttestationResponse;
  if (!(AttestationCtor && credential.response instanceof AttestationCtor)) {
    throw new TypeError("Expected AuthenticatorAttestationResponse");
  }

  const response = credential.response;
  const transports =
    typeof response.getTransports === "function"
      ? response.getTransports()
      : undefined;

  return {
    authenticatorAttachment: authenticatorAttachmentOf(credential),
    clientExtensionResults: registrationExtensionResults(credential),
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    response: {
      attestationObject: toBase64Url(response.attestationObject),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      ...(Array.isArray(transports) ? { transports } : {}),
    },
    type: "public-key",
  };
}

export function serializeAuthenticationCredential(
  value: unknown
): AthenaPasskeyAuthenticationWire {
  const credential = requirePublicKeyCredential(value);
  const AssertionCtor = (globalThis as GlobalWebAuthn)
    .AuthenticatorAssertionResponse;
  if (!(AssertionCtor && credential.response instanceof AssertionCtor)) {
    throw new TypeError("Expected AuthenticatorAssertionResponse");
  }

  const response = credential.response;
  return {
    authenticatorAttachment: authenticatorAttachmentOf(credential),
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    response: {
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
    type: "public-key",
  };
}

export function serializeCreatedPasskey(credential: unknown): string {
  return JSON.stringify(serializeRegistrationCredential(credential));
}

export function serializeAssertedPasskey(credential: unknown): string {
  return JSON.stringify(serializeAuthenticationCredential(credential));
}
