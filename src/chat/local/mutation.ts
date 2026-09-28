import {
  authorizeChatOperation,
  type ChatAuthorizationMode,
  type ChatOperation,
} from "../authorization.ts";
import type { ChatMutationCommit } from "../events.ts";
import {
  emitChatExecutionEvent,
  type ChatExecutionEvent,
} from "../observability.ts";
import { AthenaChatError } from "../error.ts";
import {
  chatPublicationFailed,
  chatTransactionFailed,
} from "./errors.ts";
import type { ChatExecutionContext } from "./principal.ts";

export interface ChatMutationInput<T> {
  authorize?: (context: ChatExecutionContext) => void;
  context: ChatExecutionContext;
  execute: () => Promise<ChatMutationCommit<T>>;
  operation: ChatOperation;
  publish: (commit: ChatMutationCommit<T>) => void;
}

export function createChatMutationExecutor(
  mode: ChatAuthorizationMode,
  onExecutionEvent: (event: ChatExecutionEvent) => void = emitChatExecutionEvent
): <T>(input: ChatMutationInput<T>) => Promise<T> {
  return <T>(input: ChatMutationInput<T>) =>
    executeChatMutation(input, mode, onExecutionEvent);
}

export async function executeChatMutation<T>(
  input: ChatMutationInput<T>,
  mode: ChatAuthorizationMode,
  onExecutionEvent: (event: ChatExecutionEvent) => void = emitChatExecutionEvent
): Promise<T> {
    const started = Date.now();
    let phase: ChatExecutionEvent["errorPhase"] = "authorize";
    try {
      authorizeChatOperation(input.context, input.operation, mode);
      input.authorize?.(input.context);
      phase = "transaction";
      const commit = await input.execute();
      phase = "publish";
      input.publish(commit);
      onExecutionEvent({
        correlationId: input.context.correlationId,
        eventId: commit.event?.eventId,
        operation: input.operation,
        organizationId: input.context.organizationId,
        outcome: "success",
        principalAuthority: input.context.resolvedPrincipal.authority,
        requestId: input.context.requestId,
        roomId: commit.event?.roomId,
        roomSeq: commit.event?.roomSeq,
        totalMs: Date.now() - started,
        traceId: input.context.traceId,
        transactionSemantics: "atomic",
      });
      return commit.value;
    } catch (error) {
      const surfacedError =
        error instanceof AthenaChatError
          ? error
          : phase === "publish"
            ? chatPublicationFailed()
            : chatTransactionFailed();
      const status =
        surfacedError && typeof surfacedError === "object" && "status" in surfacedError
          ? (surfacedError as { status?: unknown }).status
          : undefined;
      onExecutionEvent({
        correlationId: input.context.correlationId,
        errorPhase:
          status === 400 ? "validation" : phase === "authorize" ? "authorize" : phase,
        operation: input.operation,
        organizationId: input.context.organizationId,
        outcome: phase === "authorize" ? "denied" : "failure",
        principalAuthority: input.context.resolvedPrincipal.authority,
        requestId: input.context.requestId,
        totalMs: Date.now() - started,
        traceId: input.context.traceId,
        transactionSemantics: "atomic",
      });
      throw surfacedError;
    }
}
