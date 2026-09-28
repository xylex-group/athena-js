import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export type PackageExports = Record<string, unknown>;

export type RuntimeId = "node" | "browser" | "workerd" | "react-native";
export type RuntimeSupport = "supported" | "unsupported" | "unknown";
export type RuntimeClassificationKind = "explicit" | "derived" | "unknown";

export type RuntimeCompatibility = {
	node: RuntimeSupport;
	browser: RuntimeSupport;
	workerd: RuntimeSupport;
	reactNative: RuntimeSupport;
};

export type ResolvedExport = {
	exportKey: string;
	importPath: string;
	kind: "module" | "css" | "meta";
	typesPath: string | null;
	source: string | null;
	runtime: RuntimeCompatibility;
	runtimeClassification: RuntimeClassificationKind;
	framework: string[];
};

export type RuntimeClassification = {
	runtime: RuntimeCompatibility;
	runtimeClassification: RuntimeClassificationKind;
};

const SKIP_KEYS = new Set(["./package.json"]);

export function unknownRuntime(): RuntimeCompatibility {
	return {
		node: "unknown",
		browser: "unknown",
		workerd: "unknown",
		reactNative: "unknown",
	};
}

export function runtimeCompatibility(
	supported: readonly RuntimeId[],
): RuntimeClassification {
	const set = new Set(supported);
	return {
		runtime: {
			node: set.has("node") ? "supported" : "unsupported",
			browser: set.has("browser") ? "supported" : "unsupported",
			workerd: set.has("workerd") ? "supported" : "unsupported",
			reactNative: set.has("react-native") ? "supported" : "unsupported",
		},
		runtimeClassification: "explicit",
	};
}

export function unknownRuntimeClassification(): RuntimeClassification {
	return {
		runtime: unknownRuntime(),
		runtimeClassification: "unknown",
	};
}

export function supportedRuntimeIds(
	runtime: RuntimeCompatibility,
): RuntimeId[] {
	const ids: RuntimeId[] = [];
	if (runtime.node === "supported") {
		ids.push("node");
	}
	if (runtime.browser === "supported") {
		ids.push("browser");
	}
	if (runtime.workerd === "supported") {
		ids.push("workerd");
	}
	if (runtime.reactNative === "supported") {
		ids.push("react-native");
	}
	return ids;
}

export function formatRuntimeLabel(options: {
	runtime: RuntimeCompatibility;
	runtimeClassification: RuntimeClassificationKind;
}): string {
	if (options.runtimeClassification === "unknown") {
		return "unknown";
	}
	const ids = supportedRuntimeIds(options.runtime);
	return ids.length > 0 ? ids.join(", ") : "none";
}

export function packageJsonDigest(input: {
	name: string;
	version: string;
	exports: PackageExports;
}): string {
	return createHash("sha256")
		.update(JSON.stringify(input))
		.digest("hex");
}

export function readPackageJson(packageRoot: string): {
	name: string;
	version: string;
	exports: PackageExports;
} {
	const raw = JSON.parse(
		readFileSync(join(packageRoot, "package.json"), "utf8"),
	) as {
		name?: string;
		version?: string;
		exports?: PackageExports;
	};
	return {
		name: String(raw.name),
		version: String(raw.version),
		exports: (raw.exports ?? {}) as PackageExports,
	};
}

export function tryParseTsupSourceHints(
	source: string,
): Record<string, string> {
	const start = source.indexOf("entry: {");
	if (start < 0) {
		return {};
	}
	const slice = source.slice(start);
	const end = slice.indexOf("\n  },");
	const block = end >= 0 ? slice.slice(0, end) : slice;
	const map: Record<string, string> = {};
	const pattern = /(?:"([^"]+)"|(\w+)):\s*"([^"]+)"/g;
	for (const match of block.matchAll(pattern)) {
		const key = match[1] ?? match[2];
		const file = match[3];
		if (key && file) {
			map[key] = file;
		}
	}
	return map;
}

export function tryParseTsupSourceHintsFromPackage(
	packageRoot: string,
): Record<string, string> {
	const tsupPath = join(packageRoot, "tsup.config.ts");
	if (!existsSync(tsupPath)) {
		return {};
	}
	return tryParseTsupSourceHints(readFileSync(tsupPath, "utf8"));
}

/** @deprecated Use tryParseTsupSourceHintsFromPackage. */
export function parseTsupEntryMap(
	packageRoot: string,
): Record<string, string> {
	return tryParseTsupSourceHintsFromPackage(packageRoot);
}

function readTypesPath(value: unknown): string | null {
	if (typeof value === "string") {
		return value.endsWith(".d.ts") ? value : null;
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.types === "string") {
		return record.types;
	}
	const importValue = record.import;
	if (importValue && typeof importValue === "object") {
		const nested = importValue as Record<string, unknown>;
		if (typeof nested.types === "string") {
			return nested.types;
		}
	}
	if (typeof importValue === "string" && importValue.endsWith(".d.ts")) {
		return importValue;
	}
	return null;
}

function isCssExport(value: unknown, typesPath: string | null): boolean {
	if (typesPath?.endsWith(".css")) {
		return true;
	}
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	const importValue = record.import;
	const defaultValue = record.default;
	const styleValue = record.style;
	return [importValue, defaultValue, styleValue].some(
		(item) => typeof item === "string" && item.endsWith(".css"),
	);
}

function entryNameFromTypes(typesPath: string): string | null {
	const normalized = typesPath.replace(/\\/g, "/");
	const match = normalized.match(/^\.\/dist\/(.+)\.d\.ts$/);
	return match?.[1] ?? null;
}

function trySourceCandidates(
	packageRoot: string,
	exportKey: string,
	entryName: string | null,
	tsupEntries: Record<string, string>,
): string | null {
	if (entryName && tsupEntries[entryName]) {
		return tsupEntries[entryName].replace(/\\/g, "/");
	}
	if (exportKey === "." && tsupEntries.index) {
		return tsupEntries.index.replace(/\\/g, "/");
	}
	const keyPath = exportKey === "." ? "index" : exportKey.replace(/^\.\//, "");
	const candidates = [
		`src/${keyPath}.ts`,
		`src/${keyPath}.tsx`,
		`src/${keyPath}/index.ts`,
		`src/${keyPath}/index.tsx`,
	];
	for (const candidate of candidates) {
		if (existsSync(join(packageRoot, candidate))) {
			return candidate;
		}
	}
	return null;
}

export function importPathForExport(
	packageName: string,
	exportKey: string,
): string {
	return exportKey === "."
		? packageName
		: `${packageName}${exportKey.slice(1)}`;
}

export function resolvePublishedExports(options: {
	packageRoot: string;
	packageName: string;
	exports: PackageExports;
	classifyRuntime: (exportKey: string) => RuntimeClassification;
	classifyFramework: (exportKey: string) => string[];
	tsupHints?: Record<string, string>;
}): ResolvedExport[] {
	const tsupEntries =
		options.tsupHints ?? tryParseTsupSourceHintsFromPackage(options.packageRoot);
	const resolved: ResolvedExport[] = [];
	for (const [exportKey, value] of Object.entries(options.exports)) {
		if (SKIP_KEYS.has(exportKey)) {
			continue;
		}
		const typesPath = readTypesPath(value);
		if (isCssExport(value, typesPath)) {
			const cssRuntime = options.classifyRuntime(exportKey);
			resolved.push({
				exportKey,
				importPath: importPathForExport(options.packageName, exportKey),
				kind: "css",
				typesPath,
				source: typesPath,
				runtime: cssRuntime.runtime,
				runtimeClassification: cssRuntime.runtimeClassification,
				framework: [],
			});
			continue;
		}
		const entryName = typesPath ? entryNameFromTypes(typesPath) : null;
		const source = trySourceCandidates(
			options.packageRoot,
			exportKey,
			entryName,
			tsupEntries,
		);
		const classified = options.classifyRuntime(exportKey);
		resolved.push({
			exportKey,
			importPath: importPathForExport(options.packageName, exportKey),
			kind: "module",
			typesPath,
			source,
			runtime: classified.runtime,
			runtimeClassification: classified.runtimeClassification,
			framework: options.classifyFramework(exportKey),
		});
	}
	return resolved;
}

export function toPosix(from: string, to: string): string {
	return relative(from, to).replace(/\\/g, "/");
}

export function dirnamePosix(file: string): string {
	return dirname(file).replace(/\\/g, "/");
}

export const EXPORTS_FIXTURE: PackageExports = {
	".": { types: "./dist/index.d.ts" },
	"./browser": { types: "./dist/browser.d.ts" },
	"./server": { types: "./dist/server.d.ts" },
	"./styles.css": { import: "./dist/styles.css" },
	"./foo": { types: "./dist/foo.d.ts" },
	"./package.json": "./package.json",
};
