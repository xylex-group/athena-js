export type AthenaMalformedRightsSource =
	| "athena-session"
	| "custom-trusted"
	| "policy"
	| "principal"
	| "service";

export const ATHENA_MALFORMED_RIGHTS_KIND = "athena.rights.malformed" as const;

export interface AthenaMalformedRightsDiagnostic {
	kind: typeof ATHENA_MALFORMED_RIGHTS_KIND;
	malformedKeyCount: number;
	source: AthenaMalformedRightsSource;
}

export type AthenaMalformedRightsDiagnosticListener = (
	diagnostic: AthenaMalformedRightsDiagnostic,
) => void;

const listeners = new Set<AthenaMalformedRightsDiagnosticListener>();

export function subscribeAthenaMalformedRightsDiagnostics(
	listener: AthenaMalformedRightsDiagnosticListener,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function emitAthenaMalformedRightsDiagnostic(
	source: AthenaMalformedRightsSource,
	malformedKeyCount: number,
): void {
	if (malformedKeyCount <= 0) {
		return;
	}
	const diagnostic: AthenaMalformedRightsDiagnostic = Object.freeze({
		kind: ATHENA_MALFORMED_RIGHTS_KIND,
		malformedKeyCount,
		source,
	});
	for (const listener of [...listeners]) {
		listener(diagnostic);
	}
	console.warn("[athena]", diagnostic);
}
