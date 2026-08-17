import type { AthenaExecutable } from "../../query/descriptor.ts";
import { AthenaTransactionError } from "./errors.ts";
import {
  ATHENA_TRANSACTION_COMPILE,
  type AthenaTransactionOperation,
  type AthenaTransactionOperationCompiler,
} from "./types.ts";

let transactionOperationSeq = 0;

export function nextTransactionOperationId(): string {
  transactionOperationSeq += 1;
  return `txop_${transactionOperationSeq}`;
}

export function attachTransactionCompiler(
  executable: object,
  compile: AthenaTransactionOperationCompiler
): void {
  Object.defineProperty(executable, ATHENA_TRANSACTION_COMPILE, {
    configurable: true,
    enumerable: false,
    value: compile,
  });
}

export function compileTransactionOperation(
  executable: AthenaExecutable<unknown>,
  index: number
): AthenaTransactionOperation {
  const holder = executable as AthenaExecutable<unknown> & {
    [ATHENA_TRANSACTION_COMPILE]?: AthenaTransactionOperationCompiler;
  };
  const compile = holder[ATHENA_TRANSACTION_COMPILE];
  if (typeof compile !== "function") {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
      "Executable cannot be compiled into a transaction operation. Pass an unexecuted athena.from(Model) chain (select/insert/update/delete).",
      { index }
    );
  }
  const compiled = compile();
  return {
    ...compiled,
    descriptor: compiled.descriptor,
    id: compiled.id || nextTransactionOperationId(),
    index,
  };
}

export function compileTransactionOperations(
  executables: readonly AthenaExecutable<unknown>[]
): AthenaTransactionOperation[] {
  if (executables.length === 0) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_EMPTY",
      "db.transaction() requires at least one operation"
    );
  }
  return executables.map((executable, index) =>
    compileTransactionOperation(executable, index)
  );
}
