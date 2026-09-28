/**
 * Node chat materializer — local Chat borrows the selected database binding.
 */

import { createChatDatabaseFromRuntime } from "../../chat/local/database.ts";
import { createRootChatPrincipalResolver } from "../../chat/local/principal.ts";
import { createLocalChatRuntime } from "../../chat/local/runtime.ts";
import type { AthenaPostgresRuntime } from "../../postgres/owned-runtime.ts";
import type { AthenaChatRuntime } from "../../chat/runtime.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";
import type {
  AthenaChatRuntimeResources,
  AthenaRuntimeConfigBindings,
} from "../construction/types.ts";

export interface AthenaMaterializedChat {
  readonly bindings: Pick<AthenaRuntimeConfigBindings<never>, "chatRuntime">;
  readonly runtime?: AthenaChatRuntime;
}

export function materializeChat(
  plan: AthenaRuntimePlan,
  resources: AthenaChatRuntimeResources,
  databaseRuntime?: AthenaPostgresRuntime,
): AthenaMaterializedChat {
  if (resources.existingRuntime) {
    return {
      bindings: { chatRuntime: resources.existingRuntime },
      runtime: resources.existingRuntime,
    };
  }
  if (plan.chat.transport !== "local" || !databaseRuntime) {
    return { bindings: {} };
  }

  const runtime = createLocalChatRuntime({
    authorization: plan.chat.callOptions?.authorization,
    database: createChatDatabaseFromRuntime(databaseRuntime),
    resolvePrincipal: createRootChatPrincipalResolver({
      auth: plan.chat.auth,
      callOptions: plan.chat.callOptions,
      context: plan.chat.context,
      databaseUrl: plan.chat.databaseUrl,
      resolvePrincipal: plan.chat.callOptions?.resolvePrincipal,
    }),
  });
  return {
    bindings: { chatRuntime: runtime },
    runtime,
  };
}
