/**
 * Runtime parse helpers for contract schemas.
 */

import type { z } from "zod";

export interface AthenaContractIssue {
  code: string;
  message: string;
  path: PropertyKey[];
}

export class AthenaContractParseError extends Error {
  readonly issues: AthenaContractIssue[];
  readonly path: string;

  constructor(
    message: string,
    issues: AthenaContractIssue[],
    path = "body",
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AthenaContractParseError";
    this.issues = issues;
    this.path = path;
  }
}

function toContractIssues(
  issues: ReadonlyArray<{ code: string; message: string; path: PropertyKey[] }>
): AthenaContractIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: [...issue.path],
  }));
}

/**
 * Parse unknown input with a Zod schema; throw {@link AthenaContractParseError} on failure.
 * Catches recursive-schema stack overflows (RangeError on cyclic input) and rethrows as
 * {@link AthenaContractParseError} so callers always get structured issues/path.
 */
export function parseContractOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  path = "body"
): z.infer<TSchema> {
  try {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new AthenaContractParseError(
        `Contract validation failed at ${path}`,
        toContractIssues(result.error.issues),
        path
      );
    }
    return result.data;
  } catch (err) {
    if (err instanceof AthenaContractParseError) {
      throw err;
    }
    // Recursive JSON schemas can stack-overflow on cyclic objects/arrays.
    const message =
      err instanceof RangeError
        ? "Cyclic or excessively nested value rejected by contract schema"
        : err instanceof Error
          ? err.message
          : "Contract validation failed";
    // biome-ignore lint/style/useErrorCause: AthenaContractParseError forwards cause via Error options
    throw new AthenaContractParseError(
      `Contract validation failed at ${path}`,
      [{ code: "invalid_type", message, path: [] }],
      path,
      { cause: err }
    );
  }
}

/**
 * Soft parse: returns `{ success, data }` or `{ success, error }` without throwing.
 * Never throws — including on cyclic inputs that cause Zod recursive schemas to
 * hit stack overflow (RangeError); those map to a single contract issue.
 */
export function safeParseContract<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
):
  | { success: true; data: z.infer<TSchema> }
  | { success: false; error: { issues: AthenaContractIssue[] } } {
  try {
    const result = schema.safeParse(input);
    if (result.success) {
      return { data: result.data, success: true };
    }
    return {
      error: { issues: toContractIssues(result.error.issues) },
      success: false,
    };
  } catch (err) {
    // Recursive JSON schemas can stack-overflow on cyclic objects/arrays.
    const message =
      err instanceof Error ? err.message : "Contract validation failed";
    return {
      error: {
        issues: [
          {
            code: "invalid_type",
            message:
              err instanceof RangeError
                ? "Cyclic or excessively nested value rejected by contract schema"
                : message,
            path: [],
          },
        ],
      },
      success: false,
    };
  }
}
