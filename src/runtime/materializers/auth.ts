/**
 * Node auth materializer — embedded vs remote intent is recorded on the plan.
 * Handler attach stays on the Node constructor so request middleware can bind
 * the frozen client (email delivery port + proxy handlers).
 */

import type { AthenaRuntimePlan } from "../plan/types.ts";

export function materializeAuth<TConfig>(
	config: TConfig,
	_plan?: AthenaRuntimePlan,
): TConfig {
	return config;
}
