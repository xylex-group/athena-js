import type { AthenaResult } from "../../result/types.ts";
import { applyCardinality } from "../../result/cardinality.ts";
import { requireAffected } from "../../auxiliaries.ts";
import {
  attachTransactionCompiler,
  nextTransactionOperationId,
} from "../../db/transaction/index.ts";
import type {
  AthenaExecuteOptions,
  AthenaQueryDescriptor,
} from "../../query/descriptor.ts";
import type { AthenaModelTarget } from "../../schema/types.ts";
import { createCapturedAthenaExecutable } from "../../query/descriptor.ts";
import type { AthenaGatewayCallOptions } from "../../gateway/types.ts";
import type {
  AthenaProjectedMutationResult,
  AthenaSelectInput,
  AthenaSelectResult,
  AthenaValidatedSelectInput,
} from "../../select-column-types.ts";
import type {
  AthenaQueryTraceCallsite,
  MutationQuery,
} from "../contracts.ts";
import { createTraceCallsiteStore, captureTraceCallsite } from "../../query-tracing.ts";

type MutationResultRow<Result> =
  Result extends Array<infer Item> ? Item : Result;
type MutationSingleResult<Result> =
  Result extends Array<infer Item> ? Item | null : Result | null;
type MutationSelectedResult<
  Result,
  Row,
  TOverride,
  TColumns extends AthenaSelectInput,
> = AthenaProjectedMutationResult<
  Result,
  AthenaSelectResult<Row, TOverride, TColumns>
>;
type MutationSingleSelectedResult<
  Result,
  Row,
  TOverride,
  TColumns extends AthenaSelectInput,
> = AthenaProjectedMutationResult<
  MutationSingleResult<Result>,
  AthenaSelectResult<Row, TOverride, TColumns>
>;

export function createMutationQuery<Result, Row = MutationResultRow<Result>>(
  executor: (
    columns?: string | string[],
    options?: AthenaGatewayCallOptions,
    callsite?: AthenaQueryTraceCallsite | null
  ) => Promise<AthenaResult<Result>>,
  defaultColumns: AthenaSelectInput | null = "*",
  tracer?: import("../../query-tracing.ts").AthenaQueryTracer,
  initialCallsite?: AthenaQueryTraceCallsite | null,
  executable?: {
    getDescriptor: (
      projection: AthenaSelectInput | undefined
    ) => AthenaQueryDescriptor;
    model?: AthenaModelTarget;
  },
  compileTransaction?: (
    columns: string | string[] | undefined,
    options?: AthenaGatewayCallOptions
  ) => {
    kind: "fetch" | "insert" | "update" | "delete";
    payload:
      | import("../../gateway/types.ts").AthenaFetchPayload
      | import("../../gateway/types.ts").AthenaInsertPayload
      | import("../../gateway/types.ts").AthenaUpdatePayload
      | import("../../gateway/types.ts").AthenaDeletePayload;
  }
): MutationQuery<Result, Row> {
  let selectedColumns: AthenaSelectInput | undefined =
    defaultColumns === null ? undefined : defaultColumns;
  let selectedOptions: AthenaGatewayCallOptions | undefined;
  let promise: Promise<AthenaResult<Result>> | null = null;
  const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite);

  const projectResult = <Projected>(
    result: AthenaResult<unknown>
  ): AthenaResult<Projected> => ({
    ...result,
    data: result.data as Projected,
  });
  const projectCardinality = <Projected, Single>(
    result: AthenaResult<Projected>,
    mode: "single" | "maybeSingle"
  ): AthenaResult<Single> => {
    const cardinality = applyCardinality(result, mode);
    return {
      ...cardinality,
      data: cardinality.data as Single,
    };
  };

  const run = (
    columns?: AthenaSelectInput,
    options?: AthenaGatewayCallOptions,
    callsite?: AthenaQueryTraceCallsite | null
  ) => {
    const payloadColumns = columns ?? selectedColumns;
    const payloadOptions = options ?? selectedOptions;
    if (!promise) {
      promise = executor(
        normalizeSelectColumnsInput(payloadColumns),
        payloadOptions,
        callsiteStore.resolve(callsite)
      );
    }
    return promise;
  };

  const mutationQuery: MutationQuery<Result, Row> = {
    capture() {
      const capturedColumns = selectedColumns;
      const capturedOptions = selectedOptions;
      return createCapturedAthenaExecutable({
        descriptor: mutationQuery.getDescriptor(),
        execute: (executeOptions) =>
          run(capturedColumns, {
            ...capturedOptions,
            signal: executeOptions?.signal ?? capturedOptions?.signal,
          }),
        model: executable?.model,
      });
    },
    catch(onrejected) {
      return run(selectedColumns, selectedOptions).catch(onrejected);
    },
    execute(executeOptions?: AthenaExecuteOptions) {
      return run(selectedColumns, {
        ...selectedOptions,
        signal: executeOptions?.signal ?? selectedOptions?.signal,
      });
    },
    finally(onfinally) {
      return run(selectedColumns, selectedOptions).finally(onfinally);
    },
    getDescriptor() {
      if (!executable) {
        throw new Error(
          "Mutation query is missing a descriptor compiler. Pass getDescriptor when constructing the mutation."
        );
      }
      return executable.getDescriptor(selectedColumns);
    },
    maybeSingle<
      TOverride = never,
      const TColumns extends AthenaSelectInput = string,
    >(
      columns?: AthenaValidatedSelectInput<Row, TColumns>,
      options?: AthenaGatewayCallOptions
    ): Promise<
      AthenaResult<
        MutationSingleSelectedResult<Result, Row, TOverride, TColumns>
      >
    > {
      if (columns !== undefined) {
        selectedColumns = columns;
      }
      selectedOptions = options ?? selectedOptions;
      return run(
        columns ?? selectedColumns,
        options ?? selectedOptions,
        captureTraceCallsite(tracer)
      ).then((result) =>
        projectCardinality<
          MutationSelectedResult<Result, Row, TOverride, TColumns>,
          MutationSingleSelectedResult<Result, Row, TOverride, TColumns>
        >(
          projectResult<
            MutationSelectedResult<Result, Row, TOverride, TColumns>
          >(result),
          "maybeSingle"
        )
      );
    },
    async requireAffected(options?: { min?: number }) {
      const result = await run(selectedColumns, selectedOptions);
      requireAffected(result, options, {
        operation: executable ? "mutation" : undefined,
      });
      return result;
    },
    returning<
      TOverride = never,
      const TColumns extends AthenaSelectInput = string,
    >(
      columns?: AthenaValidatedSelectInput<Row, TColumns>,
      options?: AthenaGatewayCallOptions
    ): Promise<
      AthenaResult<MutationSelectedResult<Result, Row, TOverride, TColumns>>
    > {
      return mutationQuery.select<TOverride, TColumns>(columns, options);
    },
    select<
      TOverride = never,
      const TColumns extends AthenaSelectInput = string,
    >(
      columns?: AthenaValidatedSelectInput<Row, TColumns>,
      options?: AthenaGatewayCallOptions
    ): Promise<
      AthenaResult<MutationSelectedResult<Result, Row, TOverride, TColumns>>
    > {
      selectedColumns = columns;
      selectedOptions = options ?? selectedOptions;
      return run(columns, options, captureTraceCallsite(tracer)).then((result) =>
        projectResult<
          MutationSelectedResult<Result, Row, TOverride, TColumns>
        >(result)
      );
    },
    single<
      TOverride = never,
      const TColumns extends AthenaSelectInput = string,
    >(
      columns?: AthenaValidatedSelectInput<Row, TColumns>,
      options?: AthenaGatewayCallOptions
    ): Promise<
      AthenaResult<
        MutationSingleSelectedResult<Result, Row, TOverride, TColumns>
      >
    > {
      if (columns !== undefined) {
        selectedColumns = columns;
      }
      selectedOptions = options ?? selectedOptions;
      return run(
        columns ?? selectedColumns,
        options ?? selectedOptions,
        captureTraceCallsite(tracer)
      ).then((result) =>
        projectCardinality<
          MutationSelectedResult<Result, Row, TOverride, TColumns>,
          MutationSingleSelectedResult<Result, Row, TOverride, TColumns>
        >(
          projectResult<
            MutationSelectedResult<Result, Row, TOverride, TColumns>
          >(result),
          "single"
        )
      );
    },
    then(onfulfilled, onrejected) {
      return run(selectedColumns, selectedOptions).then(
        onfulfilled,
        onrejected
      );
    },
  };

  if (executable?.model) {
    Object.defineProperty(mutationQuery, "model", {
      enumerable: true,
      value: executable.model,
    });
  }

  if (compileTransaction) {
    attachTransactionCompiler(mutationQuery, () => {
      const compiled = compileTransaction(
        normalizeSelectColumnsInput(selectedColumns),
        selectedOptions
      );
      if (!compiled) {
        throw new Error("Mutation transaction compiler is unavailable");
      }
      return {
        descriptor: mutationQuery.getDescriptor(),
        id: nextTransactionOperationId(),
        index: 0,
        kind: compiled.kind,
        payload: compiled.payload,
      } as import("../../db/transaction/types.ts").AthenaTransactionOperation;
    });
  }

  return mutationQuery;
}

function normalizeSelectColumnsInput(
  columns?: AthenaSelectInput
): string | string[] | undefined {
  if (columns === undefined) {
    return;
  }
  return typeof columns === "string" ? columns : [...columns];
}
