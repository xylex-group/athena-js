export function resolveAthenaHttpUrl(input: {
  basePath: string;
  root?: string;
}): string {
  const value = input.basePath.trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  const root = input.root?.replace(/\/+$/, "") ?? "";
  if (root) {
    if (/^https?:\/\//i.test(root)) {
      return `${root}${prefixed}`;
    }
    return `${root}${prefixed}`;
  }
  const origin =
    (globalThis as { location?: { origin?: string } }).location?.origin ??
    (globalThis as { window?: { location?: { origin?: string } } }).window
      ?.location?.origin;
  if (origin) {
    return `${origin.replace(/\/+$/, "")}${prefixed}`;
  }
  return `http://localhost${prefixed}`;
}
