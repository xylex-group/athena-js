/**
 * Internal passkey server domain types.
 * Not wire DTOs (`AthenaPasskeyRecord` / wire `{ id?: string; name?: string }`).
 */

export type AthenaPasskeyDeviceKind = "singleDevice" | "multiDevice";
export type AthenaPasskeyChallengePurpose = "registration" | "authentication";

export interface AthenaStoredPasskey {
  aaguid: string | null;
  backedUp: boolean;
  counter: bigint;
  createdAt: Date;
  credentialId: Uint8Array;
  deviceType: AthenaPasskeyDeviceKind;
  id: string;
  name: string | null;
  publicKey: Uint8Array;
  residentKey: boolean | null;
  transports: AuthenticatorTransport[];
  updatedAt: Date | null;
  userId: string;
}

export type AthenaStoredPasskeyCreate = Omit<
  AthenaStoredPasskey,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export interface AthenaPasskeyChallenge {
  challengeHash: Uint8Array;
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  purpose: AthenaPasskeyChallengePurpose;
  rpId: string;
  userId: string | null;
}

export interface AthenaPasskeyChallengeCreate {
  challengeHash: Uint8Array;
  expiresAt: Date;
  purpose: AthenaPasskeyChallengePurpose;
  rpId: string;
  userId: string | null;
}

export interface AthenaPasskeyChallengeConsume {
  challengeHash: Uint8Array;
  purpose: AthenaPasskeyChallengePurpose;
  rpId: string;
  userId: string | null;
}

/** Domain RP — not the wire `{ id?: string; name?: string }`. */
export interface AthenaPasskeyRelyingParty {
  id: string;
  name: string;
  origins: readonly string[];
  relatedOrigins: readonly string[];
}

export interface AthenaPasskeyRegistrationStartInput {
  excludeCredentialIds?: readonly Uint8Array[];
  rp: AthenaPasskeyRelyingParty;
  userDisplayName: string;
  userId: string;
  userName: string;
}

export interface AthenaPasskeyRegistrationStartResult {
  challenge: Uint8Array;
  excludeCredentialIds: readonly Uint8Array[];
  rp: AthenaPasskeyRelyingParty;
  timeoutMs: number | null;
  userId: string;
}

export interface AthenaPasskeyRegistrationFinishInput {
  attestationObject: Uint8Array;
  clientDataJSON: Uint8Array;
  credentialId: Uint8Array;
  name: string | null;
  rp: AthenaPasskeyRelyingParty;
  transports: AuthenticatorTransport[];
  userId: string;
}

export interface AthenaPasskeyAuthenticationStartInput {
  allowCredentialIds?: readonly Uint8Array[];
  rp: AthenaPasskeyRelyingParty;
  userId: string | null;
}

export interface AthenaPasskeyAuthenticationStartResult {
  allowCredentialIds: readonly Uint8Array[];
  challenge: Uint8Array;
  rp: AthenaPasskeyRelyingParty;
  timeoutMs: number | null;
}

export interface AthenaPasskeyAuthenticationFinishInput {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  credentialId: Uint8Array;
  rp: AthenaPasskeyRelyingParty;
  signature: Uint8Array;
  userHandle: Uint8Array | null;
}

export interface AthenaPasskeyAuthenticationFinishResult {
  passkey: AthenaStoredPasskey;
  userId: string;
}

export interface AthenaPasskeyAuditEvent {
  at: Date;
  credentialId?: Uint8Array;
  detail?: Readonly<Record<string, string>>;
  rpId: string;
  type: string;
  userId: string | null;
}

/**
 * Explicit wire↔domain boundary. Implementations land in a later slice.
 * Engine must not duck-type `AthenaPasskeyRecord`.
 */
export interface AthenaPasskeyWireDomainMappers {
  fromWireRelyingParty(
    rp: { id?: string; name?: string },
    origins: readonly string[],
    relatedOrigins: readonly string[]
  ): AthenaPasskeyRelyingParty;
  parseTransports(value: string | null | undefined): AuthenticatorTransport[];
  serializeTransports(transports: AuthenticatorTransport[]): string | null;
  toPasskeyRecord(stored: AthenaStoredPasskey): unknown;
  toStoredPasskey(record: unknown): AthenaStoredPasskey;
  toWireRelyingParty(rp: AthenaPasskeyRelyingParty): {
    id?: string;
    name?: string;
  };
}
