import type { AthenaDataMutationScope } from "./scope.ts";
import { createDataMutationScope } from "./scope.ts";
import type { AthenaDataLifecycleHooks } from "./types.ts";

/**
 * Mutation nucleus: hooks ≠ events ≠ traces ≠ audit.
 * The executor must not know Postgres vs Memory/D1.
 */
export type ExecuteDataMutationOptions<TResult> = {
  execute: (scope: AthenaDataMutationScope) => Promise<TResult>;
  hooks?: AthenaDataLifecycleHooks;
};

export async function executeDataMutation<TResult>(
  options: ExecuteDataMutationOptions<TResult>
): Promise<TResult> {
  const scope = createDataMutationScope();
  return options.execute(scope);
}
