function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isHttpHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reads a HAL/SDK link href from either `_links` or `links`.
 * Empty strings and non-http(s) values are not checkout URLs.
 */
export function billingHalLinkHref(
  raw: unknown,
  relation: string
): string | null {
  if (!isRecord(raw) || relation.trim() === "") {
    return null;
  }
  for (const groupKey of ["_links", "links"] as const) {
    const group = raw[groupKey];
    if (!isRecord(group)) {
      continue;
    }
    const link = group[relation];
    if (!isRecord(link)) {
      continue;
    }
    const href = link.href;
    if (typeof href === "string" && href.trim() !== "" && isHttpHref(href)) {
      return href;
    }
  }
  return null;
}
