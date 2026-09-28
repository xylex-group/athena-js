export function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
