import type { AthenaCookieOptions } from "./types.ts";

function tryDecode(str: string): string {
  if (str.indexOf("%") === -1) {
    return str;
  }
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

export interface CookieAttributes {
  domain?: string;
  expires?: Date;
  httponly?: boolean;
  "max-age"?: number;
  partitioned?: boolean;
  path?: string;
  samesite?: "strict" | "lax" | "none";
  secure?: boolean;
  value: string;
  [key: string]: unknown;
}

export const SECURE_COOKIE_PREFIX = "__Secure-";
export const HOST_COOKIE_PREFIX = "__Host-";

/**
 * Remove __Secure- or __Host- prefix from cookie name.
 */
export function stripSecureCookiePrefix(cookieName: string): string {
  if (cookieName.startsWith(SECURE_COOKIE_PREFIX)) {
    return cookieName.slice(SECURE_COOKIE_PREFIX.length);
  }
  if (cookieName.startsWith(HOST_COOKIE_PREFIX)) {
    return cookieName.slice(HOST_COOKIE_PREFIX.length);
  }
  return cookieName;
}

/**
 * Split a comma-joined `Set-Cookie` header string into individual cookies.
 */
export function splitSetCookieHeader(setCookie: string): string[] {
  if (!setCookie) {
    return [];
  }

  const result: string[] = [];
  let start = 0;
  let i = 0;

  while (i < setCookie.length) {
    if (setCookie[i] === ",") {
      let j = i + 1;
      while (j < setCookie.length && setCookie[j] === " ") {
        j++;
      }
      while (
        j < setCookie.length &&
        setCookie[j] !== "=" &&
        setCookie[j] !== ";" &&
        setCookie[j] !== ","
      ) {
        j++;
      }

      if (j < setCookie.length && setCookie[j] === "=") {
        const part = setCookie.slice(start, i).trim();
        if (part) {
          result.push(part);
        }
        start = i + 1;
        while (start < setCookie.length && setCookie[start] === " ") {
          start++;
        }
        i = start;
        continue;
      }
    }
    i++;
  }

  const last = setCookie.slice(start).trim();
  if (last) {
    result.push(last);
  }

  return result;
}

export function parseSetCookieHeader(
  setCookie: string
): Map<string, CookieAttributes> {
  const cookies = new Map<string, CookieAttributes>();
  const cookieArray = splitSetCookieHeader(setCookie);

  for (const cookieString of cookieArray) {
    const parts = cookieString.split(";").map((part) => part.trim());
    const [nameValue, ...attributes] = parts;
    const [name, ...valueParts] = (nameValue || "").split("=");
    if (!name) {
      continue;
    }

    const value = unquoteCookieValue(valueParts.join("="));
    const decodedValue = tryDecode(value);
    const attrObj: CookieAttributes = { value: decodedValue };

    for (const attribute of attributes) {
      const [attrName, ...attrValueParts] = attribute.split("=");
      const attrValue = attrValueParts.join("=");
      const normalizedAttrName = attrName.trim().toLowerCase();
      switch (normalizedAttrName) {
        case "max-age":
          attrObj["max-age"] = attrValue
            ? Number.parseInt(attrValue.trim(), 10)
            : undefined;
          break;
        case "expires":
          attrObj.expires = attrValue ? new Date(attrValue.trim()) : undefined;
          break;
        case "domain":
          attrObj.domain = attrValue ? attrValue.trim() : undefined;
          break;
        case "path":
          attrObj.path = attrValue ? attrValue.trim() : undefined;
          break;
        case "secure":
          attrObj.secure = true;
          break;
        case "httponly":
          attrObj.httponly = true;
          break;
        case "samesite":
          attrObj.samesite = attrValue
            ? (attrValue.trim().toLowerCase() as "strict" | "lax" | "none")
            : undefined;
          break;
        case "partitioned":
          attrObj.partitioned = true;
          break;
        default:
          attrObj[normalizedAttrName] = attrValue ? attrValue.trim() : true;
          break;
      }
    }

    cookies.set(name, attrObj);
  }

  return cookies;
}

export function toCookieOptions(
  attributes: CookieAttributes
): AthenaCookieOptions {
  return {
    domain: attributes.domain,
    expires: attributes.expires,
    httpOnly: attributes.httponly,
    maxAge: attributes["max-age"],
    partitioned: attributes.partitioned,
    path: attributes.path,
    sameSite: attributes.samesite,
    secure: attributes.secure,
  };
}

/**
 * Cookie-name token char set per RFC 7230 §3.2.6.
 */
export const cookieNameRegex = /^[\w!#$%&'*.^`|~+-]+$/;

function unquoteCookieValue(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  return value.slice(1, -1);
}

/**
 * Parse a `Cookie` header into a key/value map.
 */
export function parseCookies(cookieHeader: string): Map<string, string> {
  const cookies = cookieHeader.split("; ");
  const cookieMap = new Map<string, string>();
  cookies.forEach((cookie) => {
    const [name, value] = cookie.split(/[=](.*)/s);
    cookieMap.set(name as string, value as string);
  });
  return cookieMap;
}

/**
 * Add or replace a cookie in the request `Cookie` header.
 */
export function setRequestCookie(
  headers: Headers,
  name: string,
  value: string
): void {
  const cookieMap = parseCookies(headers.get("cookie") || "");
  if (cookieNameRegex.test(name)) {
    cookieMap.set(name, value);
  }
  headers.set(
    "cookie",
    Array.from(
      cookieMap,
      ([key, currentValue]) => `${key}=${encodeURIComponent(currentValue)}`
    ).join("; ")
  );
}

/**
 * Merge `Set-Cookie` values into a `Cookie` header.
 */
export function applySetCookies(
  target: Headers,
  setCookieValues: Iterable<string>
): void {
  const cookieMap = parseCookies(target.get("cookie") || "");
  for (const setCookie of setCookieValues) {
    for (const [name, attr] of parseSetCookieHeader(setCookie)) {
      if (cookieNameRegex.test(name)) {
        cookieMap.set(name, attr.value);
      }
    }
  }
  target.set(
    "cookie",
    Array.from(
      cookieMap,
      ([key, currentValue]) => `${key}=${encodeURIComponent(currentValue)}`
    ).join("; ")
  );
}

export function setCookieToHeader(headers: Headers) {
  return (context: { response: Response }) => {
    const setCookieHeader = context.response.headers.get("set-cookie");
    if (!setCookieHeader) {
      return;
    }
    applySetCookies(headers, [setCookieHeader]);
  };
}
