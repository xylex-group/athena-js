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
  default?: boolean;
  kind: "boolean";
}

export interface StringOption extends CliOptionBase {
  default?: string;
  kind: "string";
}

export interface PathOption extends CliOptionBase {
  default?: string;
  kind: "path";
}

export interface EnumOption<T extends string = string> extends CliOptionBase {
  default?: T;
  kind: "enum";
  values: readonly T[];
}

export interface NumberOption extends CliOptionBase {
  default?: number;
  kind: "number";
}

export interface ListOption extends CliOptionBase {
  default?: string[];
  kind: "list";
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
  defaults?: { default?: boolean }
): BooleanOption {
  return {
    default: defaults?.default ?? false,
    description,
    flags,
    kind: "boolean",
  };
}

export function stringOption(
  flags: readonly string[],
  description?: string,
  defaults?: { default?: string; required?: boolean }
): StringOption {
  return {
    default: defaults?.default,
    description,
    flags,
    kind: "string",
    required: defaults?.required,
  };
}

export function pathOption(
  flags: readonly string[],
  description?: string,
  defaults?: { default?: string; required?: boolean }
): PathOption {
  return {
    default: defaults?.default,
    description,
    flags,
    kind: "path",
    required: defaults?.required,
  };
}

export function enumOption<T extends string>(
  flags: readonly string[],
  values: readonly T[],
  description?: string,
  defaults?: { default?: T; required?: boolean }
): EnumOption<T> {
  return {
    default: defaults?.default,
    description,
    flags,
    kind: "enum",
    required: defaults?.required,
    values,
  };
}

export function numberOption(
  flags: readonly string[],
  description?: string,
  defaults?: { default?: number; required?: boolean }
): NumberOption {
  return {
    default: defaults?.default,
    description,
    flags,
    kind: "number",
    required: defaults?.required,
  };
}

export function catalogFlagsFromOptions(
  options: Record<string, CliOptionSpec>
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
