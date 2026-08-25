import { detectAthenaRuntimeEnvironment } from "../runtime/resolve.ts";
import {
  ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
  AthenaEmailError,
} from "./errors.ts";
import type {
  AthenaEmailProvider,
  AthenaEmailProviderRuntime,
} from "./types.ts";

export function resolveAthenaEmailRuntime(
  environment = detectAthenaRuntimeEnvironment()
): AthenaEmailProviderRuntime {
  if (environment === "node") {
    return "node";
  }
  if (environment === "cloudflare") {
    return "edge";
  }
  return "browser";
}

export function assertAthenaEmailProviderRuntime(
  provider: AthenaEmailProvider,
  environment = detectAthenaRuntimeEnvironment()
): void {
  const allowed = provider.capabilities?.runtimes;
  if (!allowed || allowed.length === 0) {
    return;
  }
  const runtime = resolveAthenaEmailRuntime(environment);
  if (allowed.includes(runtime)) {
    return;
  }
  throw new AthenaEmailError(
    ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME,
    `Athena email provider "${provider.id}" cannot run in the ${runtime} runtime (requires ${allowed.join(", ")}).`
  );
}
