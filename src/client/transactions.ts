import type {
  AthenaFromOptions,
  AthenaRowShape,
  InternalClientBehaviorOptions,
  TableQueryBuilder,
} from "./fluent/types.ts";
import { createTableBuilder } from "./fluent/index.ts";
import type { AthenaGatewayCallOptions } from "../gateway/types.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import type { AthenaDbModule, AthenaTransactionClient } from "../db/module.ts";
import { AthenaTransactionError } from "../db/transaction/errors.ts";
import { nextInternalSavepointName } from "../db/transaction/index.ts";
import type { InteractiveTransactionSession } from "../db/transaction/coordinator.ts";
import type { AthenaTransactionOptions } from "../db/transaction/types.ts";
import { resolveTableNameForCall } from "../client-sql.ts";
import { createQueryExecutionRuntime } from "../query/execution/operation.ts";
import type { AthenaQueryTracer } from "../query-tracing.ts";
import type { AthenaResultFormatter } from "../result/types.ts";
import {
  isAthenaModelTarget,
  resolveAthenaModelTargetTableName,
} from "../schema/model-target.ts";
import type { AthenaModelTarget } from "../schema/types.ts";
import type { AthenaSelectInput } from "../select-column-types.ts";

export function createTransactionScopedDb<TModels>(
  input: {
    formatGatewayResult: AthenaResultFormatter;
    gateway: AthenaGatewayClient;
    behavior?: InternalClientBehaviorOptions;
    options?: AthenaTransactionOptions;
    session: InteractiveTransactionSession;
    tracer?: AthenaQueryTracer;
  }
): AthenaTransactionClient<TModels> {
  const { formatGatewayResult, gateway, session, tracer } = input;
  const transactionQueryRuntime = createQueryExecutionRuntime({
    behavior: input.behavior,
    formatGatewayResult,
    gateway,
    tracer,
  });
  const txFrom = ((
    tableOrModel: string | AthenaModelTarget,
    options?: AthenaFromOptions
  ) => {
    if (isAthenaModelTarget(tableOrModel)) {
      return createTableBuilder(
        resolveAthenaModelTargetTableName(tableOrModel),
        transactionQueryRuntime,
        { model: tableOrModel }
      );
    }
    return createTableBuilder(
      resolveTableNameForCall(tableOrModel, options?.schema),
      transactionQueryRuntime
    );
  }) as AthenaDbModule<TModels>["from"];
  const untypedFrom = txFrom as unknown as <
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    options?: AthenaFromOptions
  ) => TableQueryBuilder<Row, Insert, Update>;
  const scoped = {
    abort() {
      session.abort();
    },
    delete(
      table: string,
      options?: AthenaGatewayCallOptions & { resourceId?: string }
    ) {
      return untypedFrom(table).delete(options);
    },
    from: txFrom,
    insert(table: string, values: unknown, options?: AthenaGatewayCallOptions) {
      return untypedFrom(table).insert(values as never, options);
    },
    select(
      table: string,
      first?: AthenaGatewayCallOptions | AthenaSelectInput,
      second?: AthenaGatewayCallOptions
    ) {
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return untypedFrom(table).select(
          undefined,
          first as AthenaGatewayCallOptions
        );
      }
      return untypedFrom(table).select(
        first as AthenaSelectInput | undefined,
        second
      );
    },
    update(
      table: string,
      values: unknown,
      options?: AthenaGatewayCallOptions
    ) {
      return untypedFrom(table).update(values as never, options);
    },
    upsert(table: string, values: unknown, options?: AthenaGatewayCallOptions) {
      return untypedFrom(table).upsert(values as never, options);
    },
    async withSavepoint(callback: (tx: unknown) => Promise<unknown>) {
      if (!session.transport.createSavepoint) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_SAVEPOINT_UNSUPPORTED",
          `Savepoints are not supported by backend "${session.capabilities.backend}"`,
          { backend: session.capabilities.backend }
        );
      }
      session.savepointIndex += 1;
      const name = nextInternalSavepointName(session.savepointIndex);
      await session.transport.createSavepoint(name);
      try {
        const value = await callback(scoped);
        await session.transport.releaseSavepoint?.(name);
        return value;
      } catch (error) {
        await session.transport.rollbackToSavepoint?.(name);
        throw error;
      }
    },
    async withTransaction(callback: (tx: unknown) => Promise<unknown>) {
      if (!session.capabilities.savepoints) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_NESTING_UNSUPPORTED",
          `Nested withTransaction is not supported by backend "${session.capabilities.backend}"`,
          { backend: session.capabilities.backend }
        );
      }
      return scoped.withSavepoint(callback) as Promise<unknown>;
    },
  };
  return scoped as unknown as AthenaTransactionClient<TModels>;
}
