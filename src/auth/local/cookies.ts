import {
  ATHENA_AUTH_SESSION_COOKIE_ALIASES,
  ATHENA_AUTH_SESSION_COOKIE_NAME,
} from "../contract/index.ts";

export interface AthenaAuthCookieAttributes {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "Strict" | "Lax" | "None";
  secure?: boolean;
}

function formatCookieDate(date: Date): string {
  return date.toUTCString();
}

export function serializeCookie(
  name: string,
  value: string,
  attributes: AthenaAuthCookieAttributes = {}
): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${attributes.path ?? "/"}`);
  if (attributes.expires) {
    parts.push(`Expires=${formatCookieDate(attributes.expires)}`);
  }
  if (typeof attributes.maxAge === "number") {
    parts.push(`Max-Age=${Math.max(0, Math.floor(attributes.maxAge))}`);
  }
  if (attributes.domain) {
    parts.push(`Domain=${attributes.domain}`);
  }
  if (attributes.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (attributes.secure) {
    parts.push("Secure");
  }
  parts.push(`SameSite=${attributes.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function parseCookieHeader(
  header: string | null | undefined
): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

export function readSessionTokenFromCookies(
  header: string | null | undefined,
  cookieName = ATHENA_AUTH_SESSION_COOKIE_NAME
): string | undefined {
  const cookies = parseCookieHeader(header);
  const names = [
    cookieName,
    `.__Secure-${cookieName}`.slice(1),
    `__Secure-${cookieName}`,
    `__Host-${cookieName}`,
    ...ATHENA_AUTH_SESSION_COOKIE_ALIASES,
  ];
  for (const name of names) {
    const value = cookies.get(name);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function readBearerToken(header: string | null | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token || undefined;
}

export function shouldSetSecureCookie(
  request: Request,
  policy: boolean | "auto"
): boolean {
  if (policy === true) {
    return true;
  }
  if (policy === false) {
    return false;
  }
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function createSessionCookieHeader(
  token: string,
  options: {
    cookieName?: string;
    expiresAt: Date;
    secure: boolean;
  }
): string {
  return serializeCookie(options.cookieName ?? ATHENA_AUTH_SESSION_COOKIE_NAME, token, {
    expires: options.expiresAt,
    httpOnly: true,
    sameSite: "Lax",
    secure: options.secure,
  });
}

export function createClearSessionCookieHeader(
  cookieName = ATHENA_AUTH_SESSION_COOKIE_NAME,
  secure = false
): string {
  return serializeCookie(cookieName, "", {
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    sameSite: "Lax",
    secure,
  });
}
