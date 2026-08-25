export type AthenaDataNucleusPhase =
	| "after_hooks"
	| "before_hooks"
	| "canonicalize"
	| "execute"
	| "limits"
	| "model"
	| "policy"
	| "prepare"
	| "principal";

export type AthenaDataNucleusTimings = {
	afterHooksMs?: number;
	authorizeMs?: number;
	beforeHooksMs?: number;
	executeMs?: number;
	prepareMs?: number;
	totalMs?: number;
};

export function nowMs(): number {
	return Date.now();
}

export function createDataNucleusPhaseClock(started: number): {
	mark(phase: AthenaDataNucleusPhase): void;
	timings(): AthenaDataNucleusTimings;
} {
	const marks = new Map<AthenaDataNucleusPhase, number>();
	let previous = started;
	return {
		mark(phase) {
			const at = nowMs();
			marks.set(phase, Math.max(0, at - previous));
			previous = at;
		},
		timings() {
			const prepareMs = marks.get("prepare");
			const authorizeMs =
				(marks.get("canonicalize") ?? 0) +
				(marks.get("policy") ?? 0) +
				(marks.get("model") ?? 0) +
				(marks.get("limits") ?? 0);
			return {
				...(prepareMs !== undefined ? { prepareMs } : {}),
				...(authorizeMs > 0 ? { authorizeMs } : {}),
				...(marks.has("before_hooks")
					? { beforeHooksMs: marks.get("before_hooks") }
					: {}),
				...(marks.has("execute") ? { executeMs: marks.get("execute") } : {}),
				...(marks.has("after_hooks")
					? { afterHooksMs: marks.get("after_hooks") }
					: {}),
				totalMs: Math.max(0, nowMs() - started),
			};
		},
	};
}
