import type { AthenaEmailDeliveryPort } from "../../email/types.ts";
import type { AthenaRuntimeJwtVerifier } from "../../runtime/data/principal.ts";
import type {
  AthenaAppIdentity,
  AthenaAppIdentityInput,
} from "../app-identity.ts";
import type {
  AthenaPasskeyOnboardingOptions,
  NormalizedAthenaAuthConfig,
} from "../config.ts";
import type { LegacyAuthEmailSend } from "../email/emit.ts";
import type { AthenaAuthHooks } from "../hooks/types.ts";
import type { PasskeyRelyingPartyResolver } from "../passkey/server/relying-party.ts";
import type { AthenaPasskeyRelyingParty } from "../passkey/server/types.ts";
import type { AthenaAuthDatabase } from "./database.ts";
import type { AthenaAuthEmailStore } from "./email/store.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import type { AthenaAuthPasswordHasher } from "./password.ts";

export interface AthenaAuthHttpHandlers {
  DELETE: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  HEAD: (request: Request) => Promise<Response>;
  OPTIONS: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
}

export interface AthenaAuthServerSurface {
  handle(request: Request): Promise<Response>;
  handlers: AthenaAuthHttpHandlers;
  migrate(): Promise<void>;
}

export interface CreateAthenaAuthRuntimeOptions {
  app?: AthenaAppIdentityInput;
  autoMigrate?: boolean;
  basePath?: string;
  clock?: import("./clock.ts").AuthClock;
  config?: NormalizedAthenaAuthConfig;
  database?: AthenaAuthDatabase | string;
  delivery?: AthenaEmailDeliveryPort;
  emailDefaultsFrom?: string;
  emailDefaultsFromName?: string;
  env?: Record<string, string | undefined>;
  hasher?: AthenaAuthPasswordHasher;
  hooks?: AthenaAuthHooks;
  identity?: AthenaAppIdentity | null;
  resolveIdentityConnectionCredential?: (
    credentialRef: string
  ) => Promise<string | undefined>;
  legacySend?: LegacyAuthEmailSend;
  passkeyOnboarding?: boolean | AthenaPasskeyOnboardingOptions;
  secret?: string;
  stores?: AthenaAuthStores;
}

export interface AthenaAuthRuntime extends AthenaAuthServerSurface {
  close(): Promise<void>;
  readonly config: NormalizedAthenaAuthConfig;
  getEmailStore(): AthenaAuthEmailStore;
  getOAuthRuntimeJwtVerifier(
    resource: string
  ): Promise<AthenaRuntimeJwtVerifier>;
  getStores(): Promise<AthenaAuthStores>;
  readonly hooksRef?: AthenaAuthHooks;
  readonly passkeyRelyingParty?: AthenaPasskeyRelyingParty;
  readonly passkeyResolver?: PasskeyRelyingPartyResolver;
  setDelivery(next: AthenaEmailDeliveryPort | undefined): void;
}
