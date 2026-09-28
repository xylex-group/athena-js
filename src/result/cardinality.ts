import type { AthenaResult } from "./types.ts";

export type AthenaCardinalityMode = "single" | "maybeSingle";

export function toSingleResult<Result>(
  response: AthenaResult<Result>
): AthenaResult<
  Result extends Array<infer Item> ? Item | null : Result | null
> {
  const payload = response.data;
  const singleData = Array.isArray(payload)
    ? payload.length
      ? payload[0]
      : null
    : (payload ?? null);
  return {
    ...response,
    data: singleData as Result extends Array<infer Item>
      ? Item | null
      : Result | null,
  };
}

export function applyCardinality<Result>(
  response: AthenaResult<Result>,
  _mode: AthenaCardinalityMode
): AthenaResult<
  Result extends Array<infer Item> ? Item | null : Result | null
> {
  void _mode;
  return toSingleResult(response);
}
