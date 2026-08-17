import { parseBooleanFlag } from "../auxiliaries.ts";

interface GeneratorEnvBaseOptions<T> {
  default?: T;
  optional?: boolean;
}

export type GeneratorEnvStringOptions = GeneratorEnvBaseOptions<string>;

export type GeneratorEnvBooleanOptions = GeneratorEnvBaseOptions<boolean>;

export interface GeneratorEnvListOptions
  extends GeneratorEnvBaseOptions<readonly string[]> {
  separator?: string;
}

export type GeneratorEnvJsonOptions<T> = GeneratorEnvBaseOptions<T>;

export type GeneratorEnvOneOfOptions<T extends string> =
  GeneratorEnvBaseOptions<T>;

interface GeneratorEnvHelper {
  boolean(key: string, options?: GeneratorEnvBooleanOptions): boolean;
  boolean(
    key: string,
    options: GeneratorEnvBooleanOptions & { optional: true }
  ): boolean | undefined;
  json<T>(key: string, options?: GeneratorEnvJsonOptions<T>): T;
  json<T>(
    key: string,
    options: GeneratorEnvJsonOptions<T> & { optional: true }
  ): T | undefined;
  list(key: string, options?: GeneratorEnvListOptions): string[];
  list(
    key: string,
    options: GeneratorEnvListOptions & { optional: true }
  ): string[] | undefined;
  oneOf<const T extends string>(
    key: string,
    allowedValues: readonly T[],
    options?: GeneratorEnvOneOfOptions<T>
  ): T;
  oneOf<const T extends string>(
    key: string,
    allowedValues: readonly T[],
    options: GeneratorEnvOneOfOptions<T> & { optional: true }
  ): T | undefined;
  (key: string, options?: GeneratorEnvStringOptions): string;
  (
    key: string,
    options: GeneratorEnvStringOptions & { optional: true }
  ): string | undefined;
}

function readEnvStringValue(key: string): string | undefined {
  if (typeof process === "undefined" || !process.env) {
    return;
  }

  const value = process.env[key];
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function throwMissingEnvVar(key: string): never {
  throw new Error(
    `Generator config env var ${key} is missing or empty. Set ${key} or provide a default value.`
  );
}

function resolveEnvValue<T>(
  key: string,
  options: GeneratorEnvBaseOptions<T> | undefined,
  resolver: (rawValue: string) => T
): T | undefined {
  const rawValue = readEnvStringValue(key);
  if (rawValue === undefined) {
    if (options?.default !== undefined) {
      return options.default;
    }
    if (options?.optional) {
      return;
    }
    return throwMissingEnvVar(key);
  }

  return resolver(rawValue);
}

function resolveStringEnv(
  key: string,
  options?: GeneratorEnvStringOptions
): string | undefined {
  return resolveEnvValue(key, options, (value) => value);
}

function resolveBooleanEnv(
  key: string,
  options?: GeneratorEnvBooleanOptions
): boolean | undefined {
  return resolveEnvValue(key, options, (value) =>
    parseBooleanFlag(value, false)
  );
}

function resolveListEnv(
  key: string,
  options?: GeneratorEnvListOptions
): string[] | undefined {
  return resolveEnvValue(key, options, (value) => {
    const separator = options?.separator ?? ",";
    return value
      .split(separator)
      .map((entry) => entry.trim())
      .filter(
        (entry, index, entries) =>
          entry.length > 0 && entries.indexOf(entry) === index
      );
  })?.slice();
}

function resolveJsonEnv<T>(
  key: string,
  options?: GeneratorEnvJsonOptions<T>
): T | undefined {
  return resolveEnvValue(key, options, (value) => {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Generator config env var ${key} must contain valid JSON. ${message}`,
        { cause: error }
      );
    }
  });
}

function resolveOneOfEnv<T extends string>(
  key: string,
  allowedValues: readonly T[],
  options?: GeneratorEnvOneOfOptions<T>
): T | undefined {
  return resolveEnvValue(key, options, (value) => {
    if (allowedValues.includes(value as T)) {
      return value as T;
    }

    throw new Error(
      `Generator config env var ${key} must be one of: ${allowedValues.join(", ")}. Received: ${value}.`
    );
  });
}

function generatorEnvString(
  key: string,
  options?: GeneratorEnvStringOptions
): string;
function generatorEnvString(
  key: string,
  options: GeneratorEnvStringOptions & { optional: true }
): string | undefined;
function generatorEnvString(
  key: string,
  options?: GeneratorEnvStringOptions
): string | undefined {
  return resolveStringEnv(key, options);
}

function generatorEnvBoolean(
  key: string,
  options?: GeneratorEnvBooleanOptions
): boolean;
function generatorEnvBoolean(
  key: string,
  options: GeneratorEnvBooleanOptions & { optional: true }
): boolean | undefined;
function generatorEnvBoolean(
  key: string,
  options?: GeneratorEnvBooleanOptions
): boolean | undefined {
  return resolveBooleanEnv(key, options);
}

function generatorEnvList(
  key: string,
  options?: GeneratorEnvListOptions
): string[];
function generatorEnvList(
  key: string,
  options: GeneratorEnvListOptions & { optional: true }
): string[] | undefined;
function generatorEnvList(
  key: string,
  options?: GeneratorEnvListOptions
): string[] | undefined {
  return resolveListEnv(key, options);
}

function generatorEnvJson<T>(
  key: string,
  options?: GeneratorEnvJsonOptions<T>
): T;
function generatorEnvJson<T>(
  key: string,
  options: GeneratorEnvJsonOptions<T> & { optional: true }
): T | undefined;
function generatorEnvJson<T>(
  key: string,
  options?: GeneratorEnvJsonOptions<T>
): T | undefined {
  return resolveJsonEnv(key, options);
}

function generatorEnvOneOf<const T extends string>(
  key: string,
  allowedValues: readonly T[],
  options?: GeneratorEnvOneOfOptions<T>
): T;
function generatorEnvOneOf<const T extends string>(
  key: string,
  allowedValues: readonly T[],
  options: GeneratorEnvOneOfOptions<T> & { optional: true }
): T | undefined;
function generatorEnvOneOf<const T extends string>(
  key: string,
  allowedValues: readonly T[],
  options?: GeneratorEnvOneOfOptions<T>
): T | undefined {
  return resolveOneOfEnv(key, allowedValues, options);
}

/**
 * Typed env reader for generator configs. This keeps `athena.config.*` files
 * declarative while preserving exact field types for booleans, lists, unions,
 * and JSON-backed objects.
 */
export const generatorEnv = Object.assign(generatorEnvString, {
  boolean: generatorEnvBoolean,
  json: generatorEnvJson,
  list: generatorEnvList,
  oneOf: generatorEnvOneOf,
}) as GeneratorEnvHelper;
