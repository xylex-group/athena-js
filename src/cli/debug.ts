export function isDebugEnabled(): boolean {
	const value = (
		globalThis as { process?: { env?: Record<string, string | undefined> } }
	).process?.env?.ATHENA_JS_DEBUG;
	return value === "1" || value === "true";
}
