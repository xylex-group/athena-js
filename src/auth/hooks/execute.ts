import {
  ATHENA_AUTH_EVENT_DEFINITIONS,
  type AthenaAuthAuditResolveContext,
  type AthenaAuthEventDefinition,
  type AthenaAuthEventSubject,
  isAuditedAuthEvent,
} from "../domain/catalog.ts";
import type {
  AthenaAuthActor,
  AthenaAuthRequestContext,
} from "../domain/context.ts";
import type { AthenaAuthAuditWriter } from "../observability/audit.ts";
import { currentAuthTrace } from "../observability/traces.ts";
import type { AthenaAuthAuditEntry } from "../observability/types.ts";
import { validateAuthAuditEntry } from "../observability/validate.ts";
import type { AthenaAuthImplementedDomainEvent } from "./events.ts";
import {
  createAuthHookContext,
  runAuthAfterHooks,
  runAuthBeforeHooks,
} from "./runner.ts";
import type {
  AthenaAuthMutationScope,
  AuthMutationTransaction,
} from "./scope.ts";
import type { AthenaAuthHookEventPayloads, AthenaAuthHooks } from "./types.ts";

export type AuthDomainMutate = <
  E extends AthenaAuthImplementedDomainEvent,
  // biome-ignore lint/suspicious/noExplicitAny: mutation result type is event-specific
  TResult = any,
>(
  input: Omit<
    ExecuteAuthMutationOptions<E, TResult>,
    "auditWriter" | "hooks" | "transaction"
  >
) => Promise<TResult>;

export interface AthenaAuthMutationContext {
  actor: AthenaAuthActor;
  request: AthenaAuthRequestContext;
  traceId: string;
}

export interface AthenaAuthSecondaryEvent<
  E extends AthenaAuthImplementedDomainEvent = AthenaAuthImplementedDomainEvent,
> {
  event: E;
  input: AthenaAuthHookEventPayloads[E]["input"];
  previous?: AthenaAuthHookEventPayloads[E]["previous"];
  result: AthenaAuthHookEventPayloads[E]["result"];
}

type EventPreviousPolicy<E extends AthenaAuthImplementedDomainEvent> =
  (typeof ATHENA_AUTH_EVENT_DEFINITIONS)[E]["previous"];

export type PreviousOption<E extends AthenaAuthImplementedDomainEvent> =
  EventPreviousPolicy<E> extends "required"
    ? () => Promise<AthenaAuthHookEventPayloads[E]["previous"]>
    : () => Promise<AthenaAuthHookEventPayloads[E]["previous"] | undefined>;

type PreviousField<E extends AthenaAuthImplementedDomainEvent> =
  EventPreviousPolicy<E> extends "required"
    ? { previous: PreviousOption<E> }
    : { previous?: PreviousOption<E> };

export type ExecuteAuthMutationOptions<
  E extends AthenaAuthImplementedDomainEvent,
  // biome-ignore lint/suspicious/noExplicitAny: mutation result type is event-specific
  TResult = any,
> = {
  auditWriter?: AthenaAuthAuditWriter;
  context: AthenaAuthMutationContext;
  event: E;
  execute: (scope: AthenaAuthMutationScope) => Promise<TResult>;
  hooks?: AthenaAuthHooks;
  input: AthenaAuthHookEventPayloads[E]["input"];
  previousOf?: (
    result: TResult
  ) => AthenaAuthHookEventPayloads[E]["previous"] | undefined;
  // biome-ignore lint/suspicious/noExplicitAny: hook result mapping is event-specific
  resultOf: (result: any) => AthenaAuthHookEventPayloads[E]["result"];
  secondaryEvents?: (
    // biome-ignore lint/suspicious/noExplicitAny: hook result mapping is event-specific
    result: any
  ) => readonly AthenaAuthSecondaryEvent[];
  shouldPersistAudit?: (result: TResult) => boolean;
  transaction: AuthMutationTransaction;
} & PreviousField<E>;

function eventDefinition<E extends AthenaAuthImplementedDomainEvent>(
  event: E
): AthenaAuthEventDefinition<E> {
  return ATHENA_AUTH_EVENT_DEFINITIONS[event] as AthenaAuthEventDefinition<E>;
}

async function timePhase<T>(
  name:
    | "after_hooks"
    | "authorize"
    | "before_hooks"
    | "transaction"
    | "validate",
  fn: () => Promise<T>
): Promise<T> {
  const span = currentAuthTrace()?.phase(name);
  try {
    return await fn();
  } finally {
    span?.finish();
  }
}

function resolveAuditOrganizationId<E extends AthenaAuthImplementedDomainEvent>(
  event: E,
  context: AthenaAuthAuditResolveContext<E>,
  actor: AthenaAuthActor
): string | undefined {
  const ir = eventDefinition(event);
  if (typeof ir.resolveOrganizationId === "function") {
    return ir.resolveOrganizationId(context);
  }
  return actor.organizationId;
}

function buildAuditEntry<E extends AthenaAuthImplementedDomainEvent>(input: {
  actor: AthenaAuthActor;
  event: E;
  eventId: string;
  hookInput: AthenaAuthHookEventPayloads[E]["input"];
  previous: AthenaAuthHookEventPayloads[E]["previous"];
  request: AthenaAuthMutationContext["request"];
  result: AthenaAuthHookEventPayloads[E]["result"];
  traceId: string;
}): AthenaAuthAuditEntry {
  const ir = eventDefinition(input.event);
  const resolveContext = {
    actor: input.actor,
    input: input.hookInput,
    previous: input.previous,
    result: input.result,
  } as AthenaAuthAuditResolveContext<E>;
  const subject: AthenaAuthEventSubject | undefined =
    ir.resolveSubject(resolveContext);
  const organizationId = resolveAuditOrganizationId(
    input.event,
    resolveContext,
    input.actor
  );
  return {
    actor: input.actor,
    event: input.event,
    eventId: input.eventId,
    id: crypto.randomUUID(),
    organizationId,
    outcome: "success",
    previous: input.previous,
    request: {
      ipAddress: input.request.ipAddress,
      userAgent: input.request.userAgent,
    },
    result: input.result,
    subject,
    traceId: input.traceId,
  };
}

export async function executeAuthMutation<
  E extends AthenaAuthImplementedDomainEvent,
  TResult,
>(options: ExecuteAuthMutationOptions<E, TResult>): Promise<TResult> {
  const envelope = createAuthHookContext(options.context);
  currentAuthTrace()?.setActor(options.context.actor);
  currentAuthTrace()?.setEvent(options.event, envelope.eventId);
  const previous = options.previous ? await options.previous() : undefined;
  await timePhase("before_hooks", () =>
    runAuthBeforeHooks(options.hooks, {
      ...envelope,
      event: options.event,
      input: options.input,
      previous,
    })
  );
  let secondaryWork: Array<{
    envelope: ReturnType<typeof createAuthHookContext>;
    extra: AthenaAuthSecondaryEvent;
  }> = [];
  const result = await timePhase("transaction", () =>
    options.transaction(async (scope) => {
      const executed = await options.execute(scope);
      const persistAudit = options.shouldPersistAudit?.(executed) !== false;
      const secondary = options.secondaryEvents?.(executed) ?? [];
      secondaryWork = secondary.map((extra) => ({
        envelope: createAuthHookContext(options.context),
        extra,
      }));
      if (persistAudit) {
        const auditPrevious = options.previousOf?.(executed) ?? previous;
        if (options.auditWriter || scope.persistAudit) {
          const persistRow = async (entry: AthenaAuthAuditEntry) => {
            if (options.auditWriter) {
              await options.auditWriter.write(scope, entry);
              return;
            }
            await scope.persistAudit?.(entry);
          };
          const primaryResult = options.resultOf(executed);
          if (isAuditedAuthEvent(options.event)) {
            const primaryEntry = buildAuditEntry({
              actor: options.context.actor,
              event: options.event,
              eventId: envelope.eventId,
              hookInput: options.input,
              previous: auditPrevious,
              request: options.context.request,
              result: primaryResult,
              traceId: options.context.traceId,
            });
            validateAuthAuditEntry(
              primaryEntry,
              eventDefinition(options.event) as never
            );
            await persistRow(primaryEntry);
            for (const { envelope: extraEnvelope, extra } of secondaryWork) {
              if (!isAuditedAuthEvent(extra.event)) {
                continue;
              }
              const extraEntry = buildAuditEntry({
                actor: options.context.actor,
                event: extra.event,
                eventId: extraEnvelope.eventId,
                hookInput: extra.input,
                previous: extra.previous,
                request: options.context.request,
                result: extra.result,
                traceId: options.context.traceId,
              });
              validateAuthAuditEntry(
                extraEntry,
                eventDefinition(extra.event) as never
              );
              await persistRow(extraEntry);
            }
          } else {
            for (const { envelope: extraEnvelope, extra } of secondaryWork) {
              if (!isAuditedAuthEvent(extra.event)) {
                continue;
              }
              const extraEntry = buildAuditEntry({
                actor: options.context.actor,
                event: extra.event,
                eventId: extraEnvelope.eventId,
                hookInput: extra.input,
                previous: extra.previous,
                request: options.context.request,
                result: extra.result,
                traceId: options.context.traceId,
              });
              validateAuthAuditEntry(
                extraEntry,
                eventDefinition(extra.event) as never
              );
              await persistRow(extraEntry);
            }
          }
        }
      }
      return executed;
    })
  );
  await timePhase("after_hooks", () =>
    runAuthAfterHooks(options.hooks, {
      ...envelope,
      event: options.event,
      input: options.input,
      previous: options.previousOf?.(result) ?? previous,
      result: options.resultOf(result),
    })
  );
  for (const { envelope: extraEnvelope, extra } of secondaryWork) {
    await runAuthAfterHooks(options.hooks, {
      ...extraEnvelope,
      event: extra.event,
      input: extra.input,
      previous: extra.previous,
      result: extra.result,
    } as never);
  }
  return result;
}
