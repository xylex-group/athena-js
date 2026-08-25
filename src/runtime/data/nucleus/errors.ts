export type AthenaDataHookErrorPhase = "after" | "before" | "onError" | "prepare";

export type AthenaDataHookErrorInput = {
	error: unknown;
	event?: string;
	phase: AthenaDataHookErrorPhase;
};

export function dataHookErrorMessage(error: unknown): string {
	return error instanceof Error && error.message.trim()
		? error.message
		: String(error);
}
