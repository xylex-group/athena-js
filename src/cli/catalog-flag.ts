/**
 * Typed CLI help tokens for enum flags (`--mode auto|direct|gateway`).
 */

export type JoinPipe<T extends readonly string[]> = T extends readonly [
  infer Head extends string,
  ...infer Rest extends string[],
]
  ? Rest extends readonly []
    ? Head
    : Rest extends readonly string[]
      ? `${Head}|${JoinPipe<Rest>}`
      : never
  : never;

export function joinCatalogEnumValues<const T extends readonly string[]>(
  values: T
): JoinPipe<T> {
  return values.join("|") as JoinPipe<T>;
}

export function catalogEnumFlag<
  const Name extends string,
  const T extends readonly string[],
>(name: Name, values: T): `${Name} ${JoinPipe<T>}` {
  return `${name} ${joinCatalogEnumValues(values)}`;
}

export function isCatalogEnumValue<const T extends readonly string[]>(
  values: T,
  value: string
): value is T[number] {
  return (values as readonly string[]).includes(value);
}
