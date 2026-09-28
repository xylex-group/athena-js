/**
 * Billing materializer — selects and constructs exactly one plan binding.
 */

import {
  type AthenaBillingModule,
  createBillingModule,
} from "../../billing/module.ts";
import {
  createBillingRuntimeFacade,
  createUnavailableBillingFacade,
} from "../../billing/runtime/facade.ts";
import {
  billingSqlFromPostgresRuntime,
  bootstrapLocalBillingRuntime,
  createLocalBillingRuntimeBinding,
  type MaterializedLocalBillingRuntime,
} from "../../billing/runtime/local/materialize.ts";
import { createBillingProviderRegistry } from "../../billing/runtime/local/providers/create-registry.ts";
import { createRemoteBillingRuntime } from "../../billing/runtime/remote/runtime.ts";
import type { AthenaPostgresRuntime } from "../../postgres/owned-runtime.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";

export { bootstrapLocalBillingRuntime, createBillingProviderRegistry };

export type AthenaMaterializedBilling =
  | ({
      kind: "local";
      module: ReturnType<typeof createBillingRuntimeFacade>;
    } & MaterializedLocalBillingRuntime)
  | {
      kind: "remote";
      module: AthenaBillingModule;
      runtime: ReturnType<typeof createRemoteBillingRuntime>;
    }
  | {
      kind: "unavailable";
      module: ReturnType<typeof createUnavailableBillingFacade>;
    };

function materializeBillingBinding(
  plan: AthenaRuntimePlan,
  postgresRuntime?: AthenaPostgresRuntime,
): AthenaMaterializedBilling {
  const billing = plan.billing;
  if (billing.kind === "local") {
    const binding = createLocalBillingRuntimeBinding({
      applicationId: billing.applicationId,
      appUrl: billing.appUrl,
      catalog: billing.catalog,
      configuredProviders: billing.providers,
      customerImport: billing.customerImport,
      ingestion: billing.ingestion,
      mode: billing.mode,
      observability: billing.observability,
      ...(postgresRuntime
        ? { sql: billingSqlFromPostgresRuntime(postgresRuntime) }
        : {}),
      selfEnrollment: billing.selfEnrollment,
      testMode: billing.testMode,
    });
    return {
      ...binding,
      kind: "local",
      module: createBillingRuntimeFacade(binding.runtime),
    };
  }

  if (billing.kind === "remote") {
    const baseUrl = billing.endpoint;
    if (!baseUrl) {
      return {
        kind: "unavailable",
        module: createUnavailableBillingFacade(
          "Athena billing has no runnable remote transport.",
        ),
      };
    }
    const clientConfig = {
      apiKey: billing.apiKey ?? "",
      baseUrl,
      client: billing.client,
      headers: billing.headers,
    };
    const runtime = createRemoteBillingRuntime(clientConfig);
    const compatibility = createBillingModule(clientConfig, runtime);
    return {
      kind: "remote",
      module: createBillingRuntimeFacade(runtime, compatibility),
      runtime,
    };
  }

  return {
    kind: "unavailable",
    module: createUnavailableBillingFacade(),
  };
}

export function materializeBillingPlan(
  plan: AthenaRuntimePlan,
  postgresRuntime?: AthenaPostgresRuntime,
): AthenaMaterializedBilling {
  return materializeBillingBinding(plan, postgresRuntime);
}

export { materializeBillingCompat as materializeBilling } from "../compat/materializers.ts";
