export type CliOptionKind =
	| "boolean"
	| "string"
	| "path"
	| "enum"
	| "number"
	| "list";

export interface CliOptionBase {
	description?: string;
	flags: readonly string[];
	required?: boolean;
}

export interface BooleanOption extends CliOptionBase {
	kind: "boolean";
	default?: boolean;
}

export interface StringOption extends CliOptionBase {
	kind: "string";
	default?: string;
}

export interface PathOption extends CliOptionBase {
	kind: "path";
	default?: string;
}

export interface EnumOption<T extends string = string> extends CliOptionBase {
	kind: "enum";
	values: readonly T[];
	default?: T;
}

export interface NumberOption extends CliOptionBase {
	kind: "number";
	default?: number;
}

export interface ListOption extends CliOptionBase {
	kind: "list";
	default?: string[];
}

export type CliOptionSpec =
	| BooleanOption
	| StringOption
	| PathOption
	| EnumOption
	| NumberOption
	| ListOption;

export function booleanOption(
	flags: readonly string[],
	description?: string,
	defaults?: { default?: boolean },
): BooleanOption {
	return {
		kind: "boolean",
		flags,
		description,
		default: defaults?.default ?? false,
	};
}

export function stringOption(
	flags: readonly string[],
	description?: string,
	defaults?: { default?: string; required?: boolean },
): StringOption {
	return {
		kind: "string",
		flags,
		description,
		default: defaults?.default,
		required: defaults?.required,
	};
}

export function pathOption(
	flags: readonly string[],
	description?: string,
	defaults?: { default?: string; required?: boolean },
): PathOption {
	return {
		kind: "path",
		flags,
		description,
		default: defaults?.default,
		required: defaults?.required,
	};
}

export function enumOption<T extends string>(
	flags: readonly string[],
	values: readonly T[],
	description?: string,
	defaults?: { default?: T; required?: boolean },
): EnumOption<T> {
	return {
		kind: "enum",
		flags,
		values,
		description,
		default: defaults?.default,
		required: defaults?.required,
	};
}

export function numberOption(
	flags: readonly string[],
	description?: string,
	defaults?: { default?: number; required?: boolean },
): NumberOption {
	return {
		kind: "number",
		flags,
		description,
		default: defaults?.default,
		required: defaults?.required,
	};
}

export function catalogFlagsFromOptions(
	options: Record<string, CliOptionSpec>,
): string[] {
	const flags: string[] = [];
	for (const spec of Object.values(options)) {
		const primary = spec.flags[0];
		if (!primary) {
			continue;
		}
		if (spec.kind === "boolean") {
			flags.push(primary);
			continue;
		}
		if (spec.kind === "enum") {
			flags.push(`${primary} ${spec.values.join("|")}`);
			continue;
		}
		if (spec.kind === "number") {
			flags.push(`${primary} <n>`);
			continue;
		}
		flags.push(`${primary} <path>`);
	}
	flags.push("-h");
	return flags;
}
