import { createAuthRouter } from "./router.ts";
import { createAuthRequestMiddleware } from "./request-middleware.ts";
import { createRuntimeDependencies } from "./runtime-dependencies.ts";
import type {
	AthenaAuthHttpHandlers,
	AthenaAuthRuntime,
	AthenaAuthServerSurface,
	CreateAthenaAuthRuntimeOptions,
} from "./runtime-types.ts";
import type { AthenaAuthDatabase } from "./database.ts";

export type {
	AthenaAuthHttpHandlers,
	AthenaAuthRuntime,
	AthenaAuthServerSurface,
	CreateAthenaAuthRuntimeOptions,
} from "./runtime-types.ts";
export { createRuntimeDependencies } from "./runtime-dependencies.ts";
export { createAuthRouter } from "./router.ts";
export {
	createAuthRequestMiddleware,
	createRequestMiddleware,
} from "./request-middleware.ts";

export function createAthenaAuthRuntime(
	options: CreateAthenaAuthRuntimeOptions = {},
): AthenaAuthRuntime {
	const deps = createRuntimeDependencies(options);
	const { handleRoute } = createAuthRouter(deps);
	const handle = createAuthRequestMiddleware({ deps, handleRoute });
	const handlers: AthenaAuthHttpHandlers = {
		DELETE: handle,
		GET: handle,
		HEAD: handle,
		OPTIONS: handle,
		PATCH: handle,
		POST: handle,
		PUT: handle,
	};
	return {
		close: deps.close,
		config: deps.config,
		getStores: deps.ensureReady,
		handle,
		handlers,
		hooksRef: deps.hooksRef,
		setDelivery: deps.setDelivery,
		migrate: deps.migrate,
		passkeyRelyingParty: deps.passkeyRelyingParty,
		passkeyResolver: deps.passkeyResolver,
	};
}

export function createAthenaAuth(
	options: CreateAthenaAuthRuntimeOptions & {
		database: string | AthenaAuthDatabase;
	},
): AthenaAuthRuntime {
	return createAthenaAuthRuntime({
		...options,
		autoMigrate: options.autoMigrate === true,
	});
}

export function createAthenaAuthHttpHandlers(
	runtime: AthenaAuthServerSurface,
): AthenaAuthHttpHandlers {
	return runtime.handlers;
}
