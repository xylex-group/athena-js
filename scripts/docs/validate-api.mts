import type { DocsApiIr, DocsExemption, DocsExemptions } from "./extract-api.mts";
import {
	packageJsonDigest,
	readPackageJson,
	resolvePublishedExports,
	tryParseTsupSourceHintsFromPackage,
} from "./extract-exports.mts";

export type CoverageReport = {
	package: string;
	version: string;
	publicSymbols: number;
	documented: number;
	publicUnlisted: number;
	withDescriptions: number;
	withExamples: number;
	canonical: number;
	canonicalWithExamples: number;
	unclassified: number;
	unknownRuntimes: string[];
	staleReferences: number;
	staleExemptions: string[];
	duplicateSymbolIds: string[];
	unknownEntrypoints: string[];
	missingIrExports: string[];
	missingSources: string[];
	unpublishedTsupEntries: string[];
	canonicalMissingSummaries: string[];
	errors: string[];
};

function exemptionIds(items: DocsExemption[] | undefined): string[] {
	return (items ?? []).map((item) => item.id);
}

function validateExemptionShape(items: unknown, label: string): string[] {
	if (items == null) {
		return [];
	}
	if (!Array.isArray(items)) {
		return [`${label} must be an array of {id, reason}`];
	}
	const errors: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") {
			errors.push(`${label} entries must be objects with id and reason`);
			continue;
		}
		const record = item as { id?: unknown; reason?: unknown };
		if (typeof record.id !== "string" || record.id.length === 0) {
			errors.push(`${label} entry missing id`);
		}
		if (typeof record.reason !== "string" || record.reason.trim().length === 0) {
			errors.push(`${label} ${String(record.id ?? "?")} missing reason`);
		}
		if (record.id === "*" || record.id === "**") {
			errors.push(`${label} wildcard exemption is not allowed`);
		}
	}
	return errors;
}

export function validateDocsApi(
	ir: DocsApiIr,
	options: {
		packageRoot: string;
		exports: Record<string, unknown>;
		exemptions?: DocsExemptions;
		failCanonicalWithoutSummary?: boolean;
	},
): CoverageReport {
	const pkgSnapshot = readPackageJson(options.packageRoot);
	const resolved = resolvePublishedExports({
		packageRoot: options.packageRoot,
		packageName: ir.package.name,
		exports: options.exports,
	});
	const tsup = tryParseTsupSourceHintsFromPackage(options.packageRoot);
	const exportKeys = new Set(resolved.map((item) => item.exportKey));
	const irKeys = new Set(ir.entrypoints.map((item) => item.exportKey));
	const unknownEntrypoints = [...irKeys].filter((key) => !exportKeys.has(key));
	const missingIrExports = [...exportKeys].filter((key) => !irKeys.has(key));
	const missingSources = resolved
		.filter((item) => item.kind === "module" && !item.source)
		.map((item) => item.exportKey);
	const unknownRuntimes = ir.entrypoints
		.filter(
			(entry) =>
				entry.kind !== "css" && entry.runtimeClassification === "unknown",
		)
		.map((entry) => entry.exportKey);

	const unpublishedTsupEntries = Object.keys(tsup).filter((key) => {
		const exportKey = key === "index" ? "." : `./${key.replace(/\/index$/, "")}`;
		if (key === "cli/index") {
			return false;
		}
		return !exportKeys.has(exportKey) && !exportKeys.has(`./${key}`);
	});

	const symbols = ir.entrypoints.flatMap((entry) => entry.symbols);
	const publicSymbols = symbols.filter(
		(item) =>
			item.classification === "documented" ||
			item.classification === "reference" ||
			item.classification === "public-unlisted",
	);
	const documented = symbols.filter(
		(item) =>
			item.classification === "documented" || item.classification === "reference",
	);
	const publicUnlisted = symbols.filter(
		(item) => item.classification === "public-unlisted",
	);
	const unclassifiedSymbols = symbols
		.filter((item) => item.classification === "unknown")
		.map((item) => item.id);
	const withDescriptions = documented.filter((item) => Boolean(item.summary)).length;
	const withExamples = documented.filter((item) => item.examples.length > 0).length;
	const canonical = documented.filter((item) => item.tags.canonical);
	const canonicalWithExamples = canonical.filter((item) => item.examples.length > 0);
	const exampleSymbolIds = new Set(ir.examples.flatMap((item) => item.symbolIds));
	const knownIds = new Set(symbols.flatMap((item) => [item.id, item.name]));
	let staleReferences = 0;
	for (const id of exampleSymbolIds) {
		const hash = id.includes("#") ? id.slice(id.indexOf("#") + 1) : id;
		if (!(knownIds.has(id) || knownIds.has(hash))) {
			staleReferences += 1;
		}
	}

	const seenIds = new Map<string, number>();
	for (const symbol of symbols) {
		seenIds.set(symbol.id, (seenIds.get(symbol.id) ?? 0) + 1);
	}
	const duplicateSymbolIds = [...seenIds.entries()]
		.filter(([, count]) => count > 1)
		.map(([id]) => id);

	const exemptions = options.exemptions ?? {};
	const knownSymbolIds = new Set(symbols.map((item) => item.id));
	const knownSymbolNames = new Set(symbols.map((item) => item.name));
	const staleExemptions = [
		...exemptionIds(exemptions.exportKeys).filter((id) => !exportKeys.has(id)),
		...exemptionIds(exemptions.symbols).filter(
			(id) => !knownSymbolIds.has(id) && !knownSymbolNames.has(id),
		),
	];

	const canonicalMissingSummaries = canonical
		.filter((item) => !item.summary)
		.map((item) => item.id);

	const errors: string[] = [
		...validateExemptionShape(exemptions.exportKeys, "exportKeys"),
		...validateExemptionShape(exemptions.symbols, "symbols"),
	];
	if (unknownEntrypoints.length > 0) {
		errors.push(`unknown entrypoints in IR: ${unknownEntrypoints.join(", ")}`);
	}
	if (missingIrExports.length > 0) {
		errors.push(
			`published export without IR entry: ${missingIrExports.join(", ")}`,
		);
	}
	if (unknownRuntimes.length > 0) {
		errors.push(
			`module runtime classification unknown: ${unknownRuntimes.join(", ")}`,
		);
	}
	if (unclassifiedSymbols.length > 0) {
		errors.push(
			`unclassified public symbols: ${unclassifiedSymbols.join(", ")}`,
		);
	}
	if (duplicateSymbolIds.length > 0) {
		errors.push(`duplicate symbol identity: ${duplicateSymbolIds.join(", ")}`);
	}
	if (staleExemptions.length > 0) {
		errors.push(`stale exemptions: ${staleExemptions.join(", ")}`);
	}
	if (staleReferences > 0) {
		errors.push(`${staleReferences} example symbol references are stale`);
	}
	if (
		options.failCanonicalWithoutSummary !== false &&
		canonicalMissingSummaries.length > 0
	) {
		errors.push(
			`canonical APIs missing summaries: ${canonicalMissingSummaries.join(", ")}`,
		);
	}
	if (
		ir.source.packageJsonDigest !==
		packageJsonDigest({
			name: pkgSnapshot.name,
			version: pkgSnapshot.version,
			exports: pkgSnapshot.exports,
		})
	) {
		errors.push("IR packageJsonDigest does not match current package.json");
	}

	return {
		package: ir.package.name,
		version: ir.package.version,
		publicSymbols: publicSymbols.length,
		documented: documented.length,
		publicUnlisted: publicUnlisted.length,
		withDescriptions,
		withExamples,
		canonical: canonical.length,
		canonicalWithExamples: canonicalWithExamples.length,
		unclassified: unclassifiedSymbols.length,
		unknownRuntimes,
		staleReferences,
		staleExemptions,
		duplicateSymbolIds,
		unknownEntrypoints,
		missingIrExports,
		missingSources,
		unpublishedTsupEntries,
		canonicalMissingSummaries,
		errors,
	};
}

export function formatCoverage(report: CoverageReport): string {
	const pct = (part: number, whole: number) =>
		whole === 0 ? "n/a" : `${((part / whole) * 100).toFixed(1)}%`;
	return [
		`${report.package} documentation coverage`,
		"",
		`Public symbols          ${report.publicSymbols}`,
		`Documented              ${report.documented}  ${pct(report.documented, report.publicSymbols)}`,
		`Public-unlisted         ${report.publicUnlisted}`,
		`With descriptions       ${report.withDescriptions}  ${pct(report.withDescriptions, report.documented)}`,
		`With examples           ${report.withExamples}  ${pct(report.withExamples, report.documented)}`,
		`Canonical APIs          ${report.canonical}`,
		`Canonical with examples ${report.canonicalWithExamples}  ${pct(report.canonicalWithExamples, report.canonical)}`,
		`Unclassified            ${report.unclassified}`,
		`Unknown runtimes        ${report.unknownRuntimes.length}`,
		`Stale references        ${report.staleReferences}`,
		`Stale exemptions        ${report.staleExemptions.length}`,
	].join("\n");
}
