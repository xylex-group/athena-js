import {
	dirnamePosix,
	packageJsonDigest,
	parseTsupEntryMap,
	readPackageJson,
	resolvePublishedExports as resolvePublishedExportsCore,
	toPosix,
	tryParseTsupSourceHints,
	tryParseTsupSourceHintsFromPackage,
	formatRuntimeLabel,
	type PackageExports,
	type ResolvedExport,
	type RuntimeCompatibility,
	type RuntimeClassificationKind,
} from "./extract-exports-core.mts";
import {
	classifyAthenaJsFramework,
	classifyAthenaJsRuntime,
} from "./runtime-classification.mts";

export type { PackageExports, ResolvedExport, RuntimeCompatibility, RuntimeClassificationKind };

export {
	dirnamePosix,
	packageJsonDigest,
	parseTsupEntryMap,
	readPackageJson,
	toPosix,
	tryParseTsupSourceHints,
	tryParseTsupSourceHintsFromPackage,
	formatRuntimeLabel,
};

export function resolvePublishedExports(options: {
	packageRoot: string;
	packageName: string;
	exports: PackageExports;
	tsupHints?: Record<string, string>;
}): ResolvedExport[] {
	return resolvePublishedExportsCore({
		...options,
		classifyFramework: classifyAthenaJsFramework,
		classifyRuntime: classifyAthenaJsRuntime,
	});
}
