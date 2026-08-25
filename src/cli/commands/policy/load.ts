import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadAthenaConfig } from "../../../generator/config.ts";
import type { AthenaConfig } from "../../../generator/types.ts";
import {
	normalizePolicyDefinitions,
	type PolicyIrDocument,
	POLICY_IR_VERSION,
} from "../../../policy/index.ts";

export type LoadedPolicyDocument = {
	config: AthenaConfig;
	configPath: string;
	document: PolicyIrDocument;
};

function asDocument(input: unknown): PolicyIrDocument {
	if (
		input &&
		typeof input === "object" &&
		Array.isArray((input as PolicyIrDocument).policies)
	) {
		return input as PolicyIrDocument;
	}
	return {
		irVersion: POLICY_IR_VERSION,
		policies: normalizePolicyDefinitions(input),
	};
}

function pickModuleExport(module: Record<string, unknown>): unknown {
	if (module.default !== undefined) {
		const exported = module.default;
		if (exported && typeof exported === "object") {
			const record = exported as Record<string, unknown>;
			if (Array.isArray(record.policies) || Array.isArray(record.definitions)) {
				return exported;
			}
			if (record.policies && typeof record.policies === "object") {
				return record.policies;
			}
		}
		return exported;
	}
	if (module.policies !== undefined) {
		return module.policies;
	}
	if (module.document !== undefined) {
		return module.document;
	}
	return module;
}

async function importPoliciesPath(
	configPath: string,
	relativePath: string,
): Promise<unknown> {
	const base = dirname(configPath);
	const absolute = isAbsolute(relativePath)
		? relativePath
		: resolve(base, relativePath);
	const module = (await import(pathToFileURL(absolute).href)) as Record<
		string,
		unknown
	>;
	return pickModuleExport(module);
}

export async function loadPolicyDocument(options: {
	configPath?: string;
	cwd: string;
}): Promise<LoadedPolicyDocument> {
	const loaded = await loadAthenaConfig({
		configPath: options.configPath,
		cwd: options.cwd,
	});
	const project = loaded.config;
	if (project.policies != null) {
		const definitions = project.policies.definitions ?? project.policies;
		return {
			config: project,
			configPath: loaded.configPath,
			document: asDocument(definitions),
		};
	}
	const toolingPath = project.tooling?.policies;
	if (!toolingPath) {
		return {
			config: project,
			configPath: loaded.configPath,
			document: { irVersion: POLICY_IR_VERSION, policies: [] },
		};
	}
	const imported = await importPoliciesPath(loaded.configPath, toolingPath);
	return {
		config: project,
		configPath: loaded.configPath,
		document: asDocument(imported),
	};
}
