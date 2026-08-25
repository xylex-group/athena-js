export function createSessionToken(): string {
	return `session_${crypto.randomUUID()}`;
}

export function normalizePath(pathname: string, basePath: string): string {
	const normalizedBase = basePath.replace(/\/+$/, "") || "";
	let path = pathname;
	if (
		normalizedBase &&
		(path === normalizedBase || path.startsWith(`${normalizedBase}/`))
	) {
		path = path.slice(normalizedBase.length) || "/";
	}
	if (!path.startsWith("/")) {
		path = `/${path}`;
	}
	if (path.length > 1 && path.endsWith("/")) {
		path = path.slice(0, -1);
	}
	return path;
}

export function isUniqueViolation(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			(error as { code?: string }).code === "23505",
	);
}
