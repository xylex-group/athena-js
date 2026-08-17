/**
 * Speedrun-shaped consumer fixture for the 4.0 session contract.
 */
import type { AthenaSessionData } from "../../../src/auth/session-data.ts";
import type { GetServerSessionResult } from "../../../src/next/get-server-session.ts";
import type { ServerSessionResolver } from "../../../src/next/server-session-resolver.ts";
import type { UseSessionResult } from "../../../src/react/use-session.ts";

export type AppSession = AthenaSessionData;

export function mapServerSession(
	result: GetServerSessionResult,
): AppSession | null {
	if (!result.ok) {
		throw new Error(result.error.message);
	}
	if (!result.authenticated) {
		return null;
	}
	return result.data;
}

export function readHookOrg(session: UseSessionResult): string | null {
	return session.organizationId;
}

export function bindResolver(resolver: ServerSessionResolver) {
	return {
		getSession: () => resolver.getSession(),
		getSessionOrNull: () => resolver.getSessionOrNull(),
		requireSession: () => resolver.requireSession(),
	};
}
