import type { AthenaGatewayResponse } from "../../gateway/types.ts";
import { actionFromRuntimeOperation } from "../../policy/decision.ts";
import { runtimeDeniedResponse } from "./errors.ts";
import { ENDPOINT, emitExecutionEvent } from "./gates.ts";
import { executeDataNucleusMutation } from "./nucleus/execute.ts";
import { resolveAthenaRuntimePrincipal } from "../authority/index.ts";
import type {
	AthenaRuntimeRequest,
	AthenaRuntimeRequestContext,
	AthenaServerRuntime,
} from "./types.ts";

function semanticLifecycleHint(
	request: AthenaRuntimeRequest,
): AthenaRuntimeRequest["semanticOperation"] {
	return request.semanticOperation;
}

export async function executeAthenaRequest(
	runtime: AthenaServerRuntime,
	request: AthenaRuntimeRequest,
	context?: AthenaRuntimeRequestContext,
): Promise<AthenaGatewayResponse<unknown>> {
	void semanticLifecycleHint(request);
	const started = Date.now();
	const resolution = await resolveAthenaRuntimePrincipal(
		runtime.authMaterial,
		runtime.capabilities.security,
		context,
	);
	if (!resolution.ok) {
		const denied = runtimeDeniedResponse(
			resolution.failure.code,
			resolution.failure.message,
			ENDPOINT[request.operation] ?? ENDPOINT.fetch,
			resolution.failure.status,
		);
		emitExecutionEvent(
			runtime,
			request,
			context,
			{},
			denied,
			started,
			resolution.failure.code,
		);
		return denied;
	}
	if (context) {
		context.resolvedPrincipal = resolution.resolved;
	}
	void actionFromRuntimeOperation(request.operation);
	return executeDataNucleusMutation(
		runtime,
		request,
		context,
		resolution,
		started,
	);
}
