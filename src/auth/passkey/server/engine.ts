import type { PasskeyAuditSink } from "./audit.ts";
import type { PasskeyChallengeStore } from "./challenge-store.ts";
import type { PasskeyClock } from "./clock.ts";
import { AthenaPasskeyServerNotWiredError } from "./errors.ts";
import type { PasskeyRepository } from "./repository.ts";
import type { PasskeySessionController } from "./session.ts";
import type {
  AthenaPasskeyAuthenticationFinishInput,
  AthenaPasskeyAuthenticationFinishResult,
  AthenaPasskeyAuthenticationStartInput,
  AthenaPasskeyAuthenticationStartResult,
  AthenaPasskeyRegistrationFinishInput,
  AthenaPasskeyRegistrationStartInput,
  AthenaPasskeyRegistrationStartResult,
  AthenaStoredPasskey,
} from "./types.ts";

export interface AthenaPasskeyServerEnginePorts {
  audit: PasskeyAuditSink;
  challenges: PasskeyChallengeStore;
  clock: PasskeyClock;
  credentials: PasskeyRepository;
  sessions: PasskeySessionController;
}

export interface AthenaPasskeyServerEngine {
  finishAuthentication(
    input: AthenaPasskeyAuthenticationFinishInput
  ): Promise<AthenaPasskeyAuthenticationFinishResult>;
  finishRegistration(
    input: AthenaPasskeyRegistrationFinishInput
  ): Promise<AthenaStoredPasskey>;
  startAuthentication(
    input: AthenaPasskeyAuthenticationStartInput
  ): Promise<AthenaPasskeyAuthenticationStartResult>;
  startRegistration(
    input: AthenaPasskeyRegistrationStartInput
  ): Promise<AthenaPasskeyRegistrationStartResult>;
}

/** Internal passkey service. Same four ceremony methods as the engine. */
export type AthenaPasskeyServer = AthenaPasskeyServerEngine;

/**
 * Ports-only factory. Ceremony / SQL are later slices.
 * Must not be called from `createPasskeyModule`.
 */
export function createAthenaPasskeyServerEngine(
  ports: AthenaPasskeyServerEnginePorts
): AthenaPasskeyServerEngine {
  void ports;
  const notWired = (): never => {
    throw new AthenaPasskeyServerNotWiredError();
  };
  return {
    finishAuthentication: notWired,
    finishRegistration: notWired,
    startAuthentication: notWired,
    startRegistration: notWired,
  };
}
