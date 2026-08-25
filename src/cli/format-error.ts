import { isDebugEnabled } from "./debug.ts";
import { railBar, railError } from "./ui/rail.ts";
import { paint } from "./ui/colors.ts";
import { resolveCliCapabilities } from "./ui/capabilities.ts";
import type { CliCapabilities } from "./ui/types.ts";

interface ErrorWithCode {
	address?: unknown;
	cause?: unknown;
	code?: unknown;
	errno?: unknown;
	hostname?: unknown;
	message?: unknown;
	port?: unknown;
	stack?: unknown;
	syscall?: unknown;
}

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Unknown generator error.";
}

function extractMissingDatabaseName(message: string): string | undefined {
	const match = message.match(/database "([^"]+)" does not exist/i);
	return match?.[1];
}

function isErrorWithCode(error: unknown): error is ErrorWithCode {
	return typeof error === "object" && error !== null && "code" in error;
}

function isNetworkConnectionError(error: unknown): boolean {
	if (!isErrorWithCode(error)) {
		return false;
	}
	const code = typeof error.code === "string" ? error.code : "";
	if (
		code === "ECONNRESET" ||
		code === "ECONNREFUSED" ||
		code === "ETIMEDOUT" ||
		code === "ENOTFOUND" ||
		code === "EAI_AGAIN" ||
		code === "EPIPE" ||
		code === "EHOSTUNREACH" ||
		code === "ENETUNREACH"
	) {
		return true;
	}
	const message = normalizeErrorMessage(error).toLowerCase();
	return (
		message.includes("econnreset") ||
		message.includes("econnrefused") ||
		message.includes("etimedout") ||
		message.includes("connection terminated") ||
		message.includes("connection refused") ||
		message.includes("timeout expired")
	);
}

function collectErrorDiagnostics(error: unknown): string[] {
	const lines: string[] = [];
	if (!(isErrorWithCode(error) || error instanceof Error)) {
		return lines;
	}

	const code =
		isErrorWithCode(error) && error.code !== undefined
			? String(error.code)
			: undefined;
	if (code) {
		lines.push(`  code: ${code}`);
	}

	const errno =
		isErrorWithCode(error) && error.errno !== undefined
			? String(error.errno)
			: undefined;
	if (errno) {
		lines.push(`  errno: ${errno}`);
	}

	const syscall =
		isErrorWithCode(error) && typeof error.syscall === "string"
			? error.syscall
			: undefined;
	if (syscall) {
		lines.push(`  syscall: ${syscall}`);
	}

	const address =
		isErrorWithCode(error) && typeof error.address === "string"
			? error.address
			: undefined;
	const port =
		isErrorWithCode(error) && error.port !== undefined
			? String(error.port)
			: undefined;
	if (address || port) {
		lines.push(`  remote: ${address ?? "?"}${port ? `:${port}` : ""}`);
	}

	const hostname =
		isErrorWithCode(error) && typeof error.hostname === "string"
			? error.hostname
			: undefined;
	if (hostname) {
		lines.push(`  hostname: ${hostname}`);
	}

	let cause: unknown =
		error instanceof Error
			? error.cause
			: isErrorWithCode(error)
				? error.cause
				: undefined;
	let depth = 0;
	while (cause && depth < 4) {
		const causeMessage = normalizeErrorMessage(cause);
		const causeCode =
			isErrorWithCode(cause) && cause.code !== undefined
				? String(cause.code)
				: undefined;
		lines.push(
			`  cause[${depth}]: ${causeCode ? `${causeCode} — ` : ""}${causeMessage}`,
		);
		cause =
			cause instanceof Error
				? cause.cause
				: isErrorWithCode(cause)
					? cause.cause
					: undefined;
		depth += 1;
	}

	return lines;
}

export function formatGeneratorError(error: unknown, configPath?: string): Error {
	const diagnostics = collectErrorDiagnostics(error);
	const diagnosticsBlock =
		diagnostics.length > 0 ? ["", "Diagnostics:", ...diagnostics] : [];

	if (isErrorWithCode(error) && error.code === "3D000") {
		const message = normalizeErrorMessage(error);
		const databaseName = extractMissingDatabaseName(message);
		const databaseLabel = databaseName
			? `PostgreSQL database "${databaseName}" does not exist`
			: "The target PostgreSQL database does not exist";
		const configLabel = configPath
			? `config "${configPath}"`
			: "the resolved athena config";

		return new Error(
			[
				`${databaseLabel} (code 3D000).`,
				`Update provider.connectionString (and provider.database, if set) in ${configLabel}, or create that database before running generate.`,
				...diagnosticsBlock,
				"",
				"Hint: ATHENA_JS_DEBUG=1 pnpm exec athena-js generate",
			].join("\n"),
		);
	}

	if (isNetworkConnectionError(error)) {
		const message = normalizeErrorMessage(error);
		const configLabel = configPath
			? `config "${configPath}"`
			: "the resolved athena config";
		const code =
			isErrorWithCode(error) && typeof error.code === "string"
				? error.code
				: "network";

		return new Error(
			[
				`Schema introspection failed: database connection was reset or unreachable (${code}: ${message}).`,
				`The CLI started correctly; generate could not finish talking to Postgres for ${configLabel}.`,
				...diagnosticsBlock,
				"",
				"Check:",
				"  1. DATABASE_URL / provider.connectionString is reachable from this machine (VPN, Railway proxy, firewall).",
				'  2. The database is running and accepts connections (try `psql "$DATABASE_URL" -c "select 1"`).',
				"  3. SSL settings match the host (Railway/public proxy often needs `?sslmode=require`).",
				"  4. Retry once — ECONNRESET is often a transient proxy drop mid-introspection.",
				"",
				"For a full stack: ATHENA_JS_DEBUG=1 pnpm exec athena-js generate",
			].join("\n"),
		);
	}

	if (error instanceof Error) {
		if (diagnostics.length === 0 && !isDebugEnabled()) {
			return error;
		}
		const base = error.message || normalizeErrorMessage(error);
		return new Error(
			[
				base,
				...diagnosticsBlock,
				...(isDebugEnabled() && error.stack
					? ["", "Stack:", error.stack]
					: ["", "Hint: ATHENA_JS_DEBUG=1 pnpm exec athena-js"]),
			].join("\n"),
		);
	}

	return new Error(normalizeErrorMessage(error));
}

/**
 * Print a CLI error to stderr with optional stack when `ATHENA_JS_DEBUG=1`.
 */
export function logCliError(
	error: unknown,
	errorLog: (message: string) => void = console.error,
	capabilities: CliCapabilities = resolveCliCapabilities({ plain: true }),
): void {
	const message =
		error instanceof Error ? error.message : normalizeErrorMessage(error);
	const lines = message.includes("\n") ? message.split("\n") : [message];
	const [first, ...rest] = lines;
	errorLog(railError(first ?? message, capabilities));
	for (const line of rest) {
		if (line.length === 0) {
			errorLog(railBar("", capabilities));
			continue;
		}
		errorLog(railBar(paint(line, "dim", capabilities), capabilities));
	}

	if (isDebugEnabled() && error instanceof Error && error.stack) {
		const stackOnly = error.stack.startsWith(error.message)
			? error.stack.slice(error.message.length).replace(/^\n/, "")
			: error.stack;
		if (stackOnly) {
			errorLog(railBar(paint(stackOnly, "dim", capabilities), capabilities));
		}
	}
}
