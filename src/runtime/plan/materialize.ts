/**
 * Dispatch a resolved construction to independent Node domain materializers.
 */

import type { AthenaClientModelsInput } from "../../schema/types.ts";
import {
  materializeBillingPlan,
  type AthenaMaterializedBilling,
} from "../materializers/billing.ts";
import { materializeChat, type AthenaMaterializedChat } from "../materializers/chat.ts";
import {
  materializeDatabase,
  type AthenaMaterializedDatabase,
} from "../materializers/database.ts";
import {
  materializeStoragePlan,
  type AthenaMaterializedStorage,
} from "../materializers/storage.ts";
import type {
  AthenaRuntimeConfigBindings,
  ResolvedAthenaConstruction,
} from "../construction/types.ts";
import { recordRuntimePlanMaterialized } from "../ownership.ts";
import { validateRuntimePlan } from "./validate.ts";

export interface AthenaMaterializedRuntime<
  TModels extends AthenaClientModelsInput | undefined,
> {
  readonly billing: AthenaMaterializedBilling;
  readonly bindings: AthenaRuntimeConfigBindings<TModels>;
  readonly chat: AthenaMaterializedChat;
  readonly database: AthenaMaterializedDatabase<TModels>;
  readonly plan: ResolvedAthenaConstruction<TModels>["plan"];
  readonly storage: AthenaMaterializedStorage;
}

export function materializeRuntimePlan<
  TModels extends AthenaClientModelsInput | undefined,
>(
  construction: ResolvedAthenaConstruction<TModels>,
): AthenaMaterializedRuntime<TModels> {
  const plan = validateRuntimePlan(construction.plan);
  recordRuntimePlanMaterialized();
  const database = materializeDatabase<TModels>(plan, construction.resources.db);
  const storage = materializeStoragePlan(plan, construction.resources.storage);
  const chat = materializeChat(
    plan,
    construction.resources.chat,
    database.postgresRuntime,
  );
  const billing = materializeBillingPlan(
    plan,
    database.postgresRuntime,
  );
  return {
    billing,
    bindings: {
      ...database.bindings,
      ...storage.bindings,
      ...chat.bindings,
    },
    chat,
    database,
    plan,
    storage,
  };
}
