export function joinAthenaHttpPath(root: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  if (root) {
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
