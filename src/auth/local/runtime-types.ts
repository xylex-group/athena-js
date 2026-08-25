import type { AthenaEmailDeliveryPort } from "../../email/types.ts";
import type {
	AthenaPasskeyOnboardingOptions,
	NormalizedAthenaAuthConfig,
} from "../config.ts";
import type { LegacyAuthEmailSend } from "../email/emit.ts";
import type { AthenaAuthHooks } from "../hooks/types.ts";
import type { PasskeyRelyingPartyResolver } from "../passkey/server/relying-party.ts";
import type { AthenaPasskeyRelyingParty } from "../passkey/server/types.ts";
import type { AthenaAuthDatabase } from "./database.ts";
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
	autoMigrate?: boolean;
	basePath?: string;
	config?: NormalizedAthenaAuthConfig;
	database?: AthenaAuthDatabase | string;
	delivery?: AthenaEmailDeliveryPort;
	hasher?: AthenaAuthPasswordHasher;
	hooks?: AthenaAuthHooks;
	legacySend?: LegacyAuthEmailSend;
	passkeyOnboarding?: boolean | AthenaPasskeyOnboardingOptions;
	secret?: string;
	stores?: AthenaAuthStores;
}

export interface AthenaAuthRuntime extends AthenaAuthServerSurface {
	close(): Promise<void>;
	readonly config: NormalizedAthenaAuthConfig;
	getStores(): Promise<AthenaAuthStores>;
	readonly hooksRef?: AthenaAuthHooks;
	readonly passkeyRelyingParty?: AthenaPasskeyRelyingParty;
	readonly passkeyResolver?: PasskeyRelyingPartyResolver;
	setDelivery(next: AthenaEmailDeliveryPort | undefined): void;
}
