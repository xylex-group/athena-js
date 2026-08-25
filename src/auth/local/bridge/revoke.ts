import type { AuthBridgeCodeStore } from "../../bridge/store.ts";

export async function revokeAuthBridgeCodesForSessions(
	store: AuthBridgeCodeStore,
	sessionIds: Array<string | null | undefined>,
): Promise<void> {
	const unique = [
		...new Set(
			sessionIds.filter(
				(sessionId): sessionId is string =>
					typeof sessionId === "string" && sessionId.length > 0,
			),
		),
	];
	await Promise.all(
		unique.map((sessionId) => store.revokeForSession(sessionId, "session_revoked")),
	);
}
