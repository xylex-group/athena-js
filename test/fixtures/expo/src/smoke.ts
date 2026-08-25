/**
 * Compile-time + resolve smoke for Athena RN adapter.
 * Safe to import from an Expo app entry after wiring env.
 */
import {
	type AthenaTokenStore,
	createMemoryTokenStore,
	createNoopLifecycleAdapter,
	createNoopLinkingAdapter,
	createReactNativeClient,
} from "@xylex-group/athena/react-native";

export function buildFixtureClient(env: {
	url: string;
	key: string;
	tokenStore?: AthenaTokenStore;
}) {
	return createReactNativeClient({
		url: env.url,
		key: env.key,
		tokenStore: env.tokenStore ?? createMemoryTokenStore(),
		linking: createNoopLinkingAdapter(),
		lifecycle: createNoopLifecycleAdapter(),
	});
}

export async function smokeSelect(
	url: string,
	key: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const client = buildFixtureClient({ url, key });
	try {
		// Query builder must exist and be callable (network may fail in CI).
		const builder = client.from("fixture_smoke").select("id").limit(1);
		if (
			!builder ||
			typeof (builder as { then?: unknown }).then !== "function"
		) {
			return { ok: false, reason: "missing thenable query builder" };
		}
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
