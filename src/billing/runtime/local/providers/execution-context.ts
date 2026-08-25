import {
	resolveBillingCredential,
	type BillingResolvedCredential,
} from "../../credentials.ts";
import { resolveBillingEnvironment } from "../../environment.ts";
import type {
	BillingProviderBinding,
	BillingProviderExecutionContext,
} from "./types.ts";

export function createBillingProviderExecutionContext(input: {
	binding: BillingProviderBinding;
	testMode?: boolean;
	idempotencyKey?: string;
	signal?: AbortSignal;
	target?: { profileId?: string };
}): BillingProviderExecutionContext {
	const environment = resolveBillingEnvironment({
		testMode: input.testMode,
	});
	const resolved = resolveBillingCredential({
		provider: input.binding.provider,
		testMode: environment.testMode,
		binding: input.binding,
	});
	const credential: BillingResolvedCredential = resolved.credential;
	return {
		provider: input.binding.provider,
		environment,
		binding: input.binding,
		credential,
		target: {
			profileId: input.target?.profileId,
		},
		idempotencyKey: input.idempotencyKey,
		signal: input.signal,
	};
}
