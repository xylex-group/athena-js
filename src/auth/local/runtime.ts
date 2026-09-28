import type { AthenaAuthDatabase } from "./database.ts";
import { createAuthRequestMiddleware } from "./request-middleware.ts";
import { createAuthRouter } from "./router.ts";
import { createRuntimeDependencies } from "./runtime-dependencies.ts";
import type {
  AthenaAuthHttpHandlers,
  AthenaAuthRuntime,
  AthenaAuthServerSurface,
  CreateAthenaAuthRuntimeOptions,
} from "./runtime-types.ts";

export {
  createAuthRequestMiddleware,
  createRequestMiddleware,
} from "./request-middleware.ts";
export { createAuthRouter } from "./router.ts";
export { createRuntimeDependencies } from "./runtime-dependencies.ts";
export type {
  AthenaAuthHttpHandlers,
  AthenaAuthRuntime,
  AthenaAuthServerSurface,
  CreateAthenaAuthRuntimeOptions,
} from "./runtime-types.ts";

export function createAthenaAuthRuntime(
  options: CreateAthenaAuthRuntimeOptions = {}
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
    getEmailStore: deps.getEmailStore,
    getOAuthRuntimeJwtVerifier: deps.getOAuthRuntimeJwtVerifier,
    handle,
    handlers,
    hooksRef: deps.hooksRef,
    migrate: deps.migrate,
    passkeyRelyingParty: deps.passkeyRelyingParty,
    passkeyResolver: deps.passkeyResolver,
    setDelivery: deps.setDelivery,
  };
}

export function createAthenaAuth(
  options: CreateAthenaAuthRuntimeOptions & {
    database: string | AthenaAuthDatabase;
  }
): AthenaAuthRuntime {
  return createAthenaAuthRuntime({
    ...options,
    autoMigrate: options.autoMigrate === true,
  });
}

export function createAthenaAuthHttpHandlers(
  runtime: AthenaAuthServerSurface
): AthenaAuthHttpHandlers {
  return runtime.handlers;
}
