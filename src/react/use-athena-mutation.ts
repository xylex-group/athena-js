import type { AthenaExecutable } from "../query/descriptor.ts";
import { useAthenaQueryClient } from "./provider.ts";
import type { UseMutationOptions, UseMutationResult } from "./types.ts";
import { useMutation } from "./use-mutation.ts";

export type UseAthenaMutationOptions<TVariables, TResult> = Omit<
  UseMutationOptions<TVariables, TResult, TResult>,
  "mutationFn"
> & {
  optimistic?: (
    cache: import("./query-client.ts").AthenaCacheTransaction,
    input: TVariables
  ) => void;
};

/**
 * Run an Athena executable mutation and reconcile the entity graph.
 *
 * Pass a factory so each call builds a fresh chain:
 *
 * ```ts
 * useAthenaMutation((input: { fileId: string; displayName: string }) =>
 *   athena.from(File).update({ displayName: input.displayName }).eq("fileId", input.fileId)
 * )
 * ```
 */
export function useAthenaMutation<TVariables, TResult>(
  createExecutable: (variables: TVariables) => AthenaExecutable<TResult>,
  options: UseAthenaMutationOptions<TVariables, TResult> = {}
): UseMutationResult<TVariables, TResult> {
  const client = useAthenaQueryClient();

  const { optimistic, onMutate, ...rest } = options;
  return useMutation<TVariables, TResult, TResult>({
    ...rest,
    mutationFn: async (variables) => {
      const executable = createExecutable(variables).capture();
      const result = await executable.execute();
      client.reconcileExecutable(
        executable.getDescriptor(),
        result,
        executable.model
      );
      return result;
    },
    onMutate: async (variables) => {
      const previous = await onMutate?.(variables);
      if (!optimistic) {
        return typeof previous === "function" ? previous : undefined;
      }
      const undoOptimistic = client.mutateCache((cache) => {
        optimistic(cache, variables);
      });
      return async () => {
        undoOptimistic();
        if (typeof previous === "function") {
          await previous();
        }
      };
    },
  });
}
