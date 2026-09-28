import type { AthenaGatewayResponse } from "../../../gateway/types.ts";
import { actionFromRuntimeOperation } from "../../../policy/decision.ts";
import type { AthenaPolicyRegistry } from "../../../policy/registry.ts";
import type {
  AthenaAuthorizationAction,
  AthenaAuthorizationAllowDecision,
  AthenaAuthorizationDenyDecision,
  AthenaAuthorizationDenyReason,
  AthenaAuthorizationResource,
} from "../../authorization/decision-ir.ts";
import { authorizeAthenaAuthorization } from "../../authorization/engine.ts";
import type { AthenaModelAuthorizationBindingRegistry } from "../../authorization/binding-registry.ts";
import type { AthenaAuthorizationUnmatchedResourceMode } from "../../authorization/config.ts";
import { scopeSubjectFromBindingKind } from "../../authorization/resource-context.ts";
import { runtimeDeniedResponse } from "../errors.ts";
import { ENDPOINT } from "../gates.ts";
import { resourceNameFromPayload } from "../model-registry.ts";
import type { AthenaPrincipal } from "../principal.ts";
import type { AthenaRuntimeRequest } from "../types.ts";
import { applyDataAuthorizationObligations } from "./obligations.ts";
import { readDeclaredScopeValue } from "./scope-write.ts";
import {
  brandAuthorizedDataPayload,
  type FrozenAuthorizedMutation,
} from "./types.ts";

export type AthenaDataAuthorizationPhase =
  | "principal"
  | "binding"
  | "decision"
  | "allow"
  | "obligations"
  | "brand";

export interface AthenaDataNucleusAuthorizationInput {
  authorizationBindings?: Pick<AthenaModelAuthorizationBindingRegistry, "get">;
  onPhase?: (phase: AthenaDataAuthorizationPhase) => void;
  policies?: AthenaPolicyRegistry;
  principal: AthenaPrincipal;
  request: AthenaRuntimeRequest;
  oauthScopePolicy?: Partial<
    Record<AthenaRuntimeRequest["operation"], readonly string[]>
  >;
  unmatchedResources?: AthenaAuthorizationUnmatchedResourceMode;
}

export type AthenaDataNucleusAuthorizationResult =
  | {
      action?: AthenaAuthorizationAction;
      authorized: FrozenAuthorizedMutation;
      binding?: ReturnType<NonNullable<AthenaDataNucleusAuthorizationInput["authorizationBindings"]>["get"]>;
      decision?: AthenaAuthorizationAllowDecision;
      secondaryDecision?: AthenaAuthorizationAllowDecision;
      ok: true;
    }
  | {
      action?: AthenaAuthorizationAction;
      binding?: ReturnType<NonNullable<AthenaDataNucleusAuthorizationInput["authorizationBindings"]>["get"]>;
      decision?: AthenaAuthorizationAllowDecision | AthenaAuthorizationDenyDecision;
      secondaryDecision?: AthenaAuthorizationAllowDecision | AthenaAuthorizationDenyDecision;
      ok: false;
      response: AthenaGatewayResponse<unknown>;
    };

export interface AthenaAuthorizedDispatchInput
  extends AthenaDataNucleusAuthorizationInput {
  dispatch: (
    payload: unknown,
    authorization: Extract<AthenaDataNucleusAuthorizationResult, { ok: true }>
  ) =>
    | Promise<AthenaGatewayResponse<unknown>>
    | AthenaGatewayResponse<unknown>;
}

export interface AthenaAuthorizedDispatchResult {
  authorization: AthenaDataNucleusAuthorizationResult;
  response: AthenaGatewayResponse<unknown>;
}

function markPhase(
  onPhase: AthenaDataNucleusAuthorizationInput["onPhase"],
  phase: AthenaDataAuthorizationPhase
): void {
  onPhase?.(phase);
}

function endpointForRequest(
  request: AthenaRuntimeRequest
): keyof typeof ENDPOINT {
  return request.operation in ENDPOINT ? request.operation : "fetch";
}

function oauthScopeDenied(input: {
  endpoint: keyof typeof ENDPOINT;
  operation: AthenaRuntimeRequest["operation"];
  policy?: Partial<
    Record<AthenaRuntimeRequest["operation"], readonly string[]>
  >;
  principal: AthenaPrincipal;
}): AthenaGatewayResponse<unknown> | undefined {
  if (input.principal.oauth == null) {
    return;
  }
  const required = input.policy?.[input.operation];
  if (required == null) {
    return runtimeDeniedResponse(
      "ATHENA_POLICY_DENIED",
      "The OAuth delegation does not include the required scope.",
      ENDPOINT[input.endpoint],
      403
    );
  }
  const granted = new Set(input.principal.oauth.scopes ?? []);
  if (required.every((scope) => granted.has(scope))) {
    return;
  }
  return runtimeDeniedResponse(
    "ATHENA_POLICY_DENIED",
    "The OAuth delegation does not include the required scope.",
    ENDPOINT[input.endpoint],
    403
  );
}

function denyResponseFromReason(
  reason: AthenaAuthorizationDenyReason,
  endpoint: keyof typeof ENDPOINT,
  messageOverride?: string
): AthenaGatewayResponse<unknown> {
  switch (reason.kind) {
    case "missing_right":
      return runtimeDeniedResponse(
        "ATHENA_POLICY_DENIED",
        messageOverride ?? "Athena authorization denied this operation.",
        ENDPOINT[endpoint]
      );
    case "policy_denied":
      return runtimeDeniedResponse(
        "ATHENA_POLICY_DENIED",
        messageOverride ?? "Athena Policy denied this operation.",
        ENDPOINT[endpoint]
      );
    case "scope_mismatch":
      return runtimeDeniedResponse(
        "ATHENA_MODEL_NOT_EXPOSED",
        messageOverride ?? "Resource was not found.",
        ENDPOINT[endpoint],
        404
      );
    case "trusted_subject_missing":
      return runtimeDeniedResponse(
        "ATHENA_AUTH_REQUIRED",
        messageOverride ??
          `Trusted ${reason.subject} is required for scoped authorization.`,
        ENDPOINT[endpoint],
        401
      );
    case "principal_invalid":
      return runtimeDeniedResponse(
        "ATHENA_AUTH_REQUIRED",
        messageOverride ?? reason.detail,
        ENDPOINT[endpoint],
        401
      );
    case "unauthenticated":
      return runtimeDeniedResponse(
        "ATHENA_AUTH_REQUIRED",
        messageOverride ??
          "Authentication is required for this Athena Local Runtime.",
        ENDPOINT[endpoint],
        401
      );
  }
}

function scopeResourceValue(input: {
  payload: unknown;
  scope?: {
    column: { logical: string; physical: string };
    kind: "organization" | "tenant" | "user";
  };
}): Pick<AthenaAuthorizationResource, "organizationId" | "tenantId" | "userId"> {
  if (!input.scope) {
    return {};
  }
  const value = readDeclaredScopeValue(
    input.payload,
    input.scope.column.physical
  );
  if (!value) {
    return {};
  }
  switch (scopeSubjectFromBindingKind(input.scope.kind)) {
    case "organizationId":
      return { organizationId: value };
    case "tenantId":
      return { tenantId: value };
    case "userId":
      return { userId: value };
  }
}

function authorizationResource(input: {
  binding: NonNullable<
    ReturnType<NonNullable<AthenaDataNucleusAuthorizationInput["authorizationBindings"]>["get"]>
  >;
  payload: unknown;
}): AthenaAuthorizationResource {
  return {
    kind: input.binding.resource.table,
    ...scopeResourceValue({
      payload: input.payload,
      scope: input.binding.scope,
    }),
  };
}

function isUpsertRequest(request: AthenaRuntimeRequest): boolean {
  if (request.semanticOperation === "upsert") {
    return true;
  }
  const payload =
    request.payload && typeof request.payload === "object"
      ? (request.payload as Record<string, unknown>)
      : undefined;
  return Boolean(payload && Object.hasOwn(payload, "update_body"));
}

function updateImagePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  return {
    ...record,
    insert_body: undefined,
  };
}

export function authorizeDataNucleusMutation(
  input: AthenaDataNucleusAuthorizationInput
): AthenaDataNucleusAuthorizationResult {
  markPhase(input.onPhase, "principal");
  const endpoint = endpointForRequest(input.request);
  const oauthDenied = oauthScopeDenied({
    endpoint,
    operation: input.request.operation,
    policy: input.oauthScopePolicy,
    principal: input.principal,
  });
  if (oauthDenied) {
    return { ok: false, response: oauthDenied };
  }

  const action = actionFromRuntimeOperation(input.request.operation);
  if (!action) {
    markPhase(input.onPhase, "brand");
    return {
      action: undefined,
      authorized: brandAuthorizedDataPayload(input.request.payload),
      ok: true,
    };
  }

  markPhase(input.onPhase, "binding");
  const resource = resourceNameFromPayload(input.request.payload);
  const binding = resource
    ? input.authorizationBindings?.get(resource)
    : undefined;
  if (!binding) {
    if (input.unmatchedResources === "deny") {
      return {
        action,
        ok: false,
        response: runtimeDeniedResponse(
          "ATHENA_MODEL_NOT_EXPOSED",
          "Resource was not found.",
          ENDPOINT[endpoint],
          404
        ),
      };
    }
    markPhase(input.onPhase, "brand");
    return {
      action,
      authorized: brandAuthorizedDataPayload(input.request.payload),
      ok: true,
    };
  }

  markPhase(input.onPhase, "decision");
  const decision = authorizeAthenaAuthorization({
    action,
    binding,
    ...(input.policies ? { policies: input.policies } : {}),
    principal: input.principal,
    requiredRight: binding.rights[action],
    resource: authorizationResource({
      binding,
      payload: input.request.payload,
    }),
  });
  if (decision.outcome !== "allow") {
    return {
      action,
      binding,
      decision,
      ok: false,
      response: denyResponseFromReason(decision.reason, endpoint),
    };
  }

  markPhase(input.onPhase, "allow");
  markPhase(input.onPhase, "obligations");
  let obligated = applyDataAuthorizationObligations({
    action,
    obligations: decision.obligations,
    payload: input.request.payload,
    principal: input.principal,
  });
  if (!obligated.ok) {
    return {
      action,
      binding,
      ok: false,
      response: denyResponseFromReason(
        obligated.reason,
        endpoint,
        obligated.message
      ),
    };
  }

  let secondaryDecision: AthenaAuthorizationAllowDecision | undefined;
  if (action === "insert" && isUpsertRequest(input.request)) {
    const updateScopeDenied = oauthScopeDenied({
      endpoint,
      operation: "update",
      policy: input.oauthScopePolicy,
      principal: input.principal,
    });
    if (updateScopeDenied) {
      return {
        action,
        binding,
        decision,
        ok: false,
        response: updateScopeDenied,
      };
    }
    const updateDecision = authorizeAthenaAuthorization({
      action: "update",
      binding,
      ...(input.policies ? { policies: input.policies } : {}),
      principal: input.principal,
      requiredRight: binding.rights.update,
      resource: authorizationResource({
        binding,
        payload: updateImagePayload(input.request.payload),
      }),
    });
    if (updateDecision.outcome !== "allow") {
      return {
        action,
        binding,
        decision,
        secondaryDecision: updateDecision,
        ok: false,
        response: denyResponseFromReason(updateDecision.reason, endpoint),
      };
    }
    secondaryDecision = updateDecision;
    obligated = applyDataAuthorizationObligations({
      action: "update",
      obligations: updateDecision.obligations,
      payload: obligated.payload,
      principal: input.principal,
    });
    if (!obligated.ok) {
      return {
        action,
        binding,
        decision,
        secondaryDecision: updateDecision,
        ok: false,
        response: denyResponseFromReason(
          obligated.reason,
          endpoint,
          obligated.message
        ),
      };
    }
  }

  markPhase(input.onPhase, "brand");
  return {
    action,
    authorized: brandAuthorizedDataPayload(obligated.payload),
    binding,
    decision,
    ...(secondaryDecision ? { secondaryDecision } : {}),
    ok: true,
  };
}

export async function authorizeAndDispatchDataNucleusMutation(
  input: AthenaAuthorizedDispatchInput
): Promise<AthenaAuthorizedDispatchResult> {
  const authorization = authorizeDataNucleusMutation(input);
  if (!authorization.ok) {
    return {
      authorization,
      response: authorization.response,
    };
  }
  const response = await input.dispatch(
    authorization.authorized.payload,
    authorization
  );
  return { authorization, response };
}
