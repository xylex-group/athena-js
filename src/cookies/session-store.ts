import { decodeBase64UrlToString } from "./base64.ts";
import { parseCookies } from "./cookie-utils.ts";
import type {
  AthenaCookieContextRuntime,
  AthenaCookieOptions,
} from "./types.ts";

const ALLOWED_COOKIE_SIZE = 4096;
const ESTIMATED_EMPTY_COOKIE_SIZE = 200;
const CHUNK_SIZE = ALLOWED_COOKIE_SIZE - ESTIMATED_EMPTY_COOKIE_SIZE;

interface StoreCookie {
  attributes: AthenaCookieOptions;
  name: string;
  value: string;
}

type Chunks = Record<string, string>;

function getChunkIndex(cookieName: string): number {
  const parts = cookieName.split(".");
  const lastPart = parts.at(-1);
  const index = Number.parseInt(lastPart || "0", 10);
  return Number.isNaN(index) ? 0 : index;
}

function readExistingChunks(
  cookieName: string,
  ctx: AthenaCookieContextRuntime
): Chunks {
  const chunks: Chunks = {};
  const cookies = parseCookies(ctx.headers?.get("cookie") || "");
  for (const [name, value] of cookies) {
    if (name.startsWith(cookieName)) {
      chunks[name] = value;
    }
  }
  return chunks;
}

function joinChunks(chunks: Chunks): string {
  const sortedKeys = Object.keys(chunks).sort(
    (left, right) => getChunkIndex(left) - getChunkIndex(right)
  );
  return sortedKeys.map((key) => chunks[key]).join("");
}

function chunkCookie(
  storeName: string,
  cookie: StoreCookie,
  chunks: Chunks,
  ctx: AthenaCookieContextRuntime
): StoreCookie[] {
  const chunkCount = Math.ceil(cookie.value.length / CHUNK_SIZE);
  if (chunkCount === 1) {
    chunks[cookie.name] = cookie.value;
    return [cookie];
  }

  const cookies: StoreCookie[] = [];
  for (let index = 0; index < chunkCount; index++) {
    const name = `${cookie.name}.${index}`;
    const start = index * CHUNK_SIZE;
    const value = cookie.value.slice(start, start + CHUNK_SIZE);
    cookies.push({
      ...cookie,
      name,
      value,
    });
    chunks[name] = value;
  }

  ctx.logger?.debug?.(`CHUNKING_${storeName.toUpperCase()}_COOKIE`, {
    chunkCount,
    chunks: cookies.map(
      (entry) => entry.value.length + ESTIMATED_EMPTY_COOKIE_SIZE
    ),
    emptyCookieSize: ESTIMATED_EMPTY_COOKIE_SIZE,
    message: `${storeName} cookie exceeds allowed ${ALLOWED_COOKIE_SIZE} bytes.`,
    valueSize: cookie.value.length,
  });

  return cookies;
}

function getCleanCookies(
  chunks: Chunks,
  cookieOptions: AthenaCookieOptions
): Record<string, StoreCookie> {
  const cleanedChunks: Record<string, StoreCookie> = {};
  for (const name of Object.keys(chunks)) {
    cleanedChunks[name] = {
      attributes: {
        ...cookieOptions,
        maxAge: 0,
      },
      name,
      value: "",
    };
  }
  return cleanedChunks;
}

const storeFactory =
  (storeName: string) =>
  (
    cookieName: string,
    cookieOptions: AthenaCookieOptions,
    ctx: AthenaCookieContextRuntime
  ) => {
    const chunks = readExistingChunks(cookieName, ctx);

    return {
      chunk(
        value: string,
        options?: Partial<AthenaCookieOptions>
      ): StoreCookie[] {
        const cleanedChunks = getCleanCookies(chunks, cookieOptions);
        for (const name of Object.keys(chunks)) {
          delete chunks[name];
        }

        const cookies: Record<string, StoreCookie> = cleanedChunks;
        const chunked = chunkCookie(
          storeName,
          {
            attributes: {
              ...cookieOptions,
              ...options,
            },
            name: cookieName,
            value,
          },
          chunks,
          ctx
        );
        for (const chunk of chunked) {
          cookies[chunk.name] = chunk;
        }
        return Object.values(cookies);
      },
      clean(): StoreCookie[] {
        const cleanedChunks = getCleanCookies(chunks, cookieOptions);
        for (const name of Object.keys(chunks)) {
          delete chunks[name];
        }
        return Object.values(cleanedChunks);
      },
      getValue(): string {
        return joinChunks(chunks);
      },
      hasChunks(): boolean {
        return Object.keys(chunks).length > 0;
      },
      setCookies(cookies: StoreCookie[]): void {
        for (const cookie of cookies) {
          ctx.setCookie(cookie.name, cookie.value, cookie.attributes);
        }
      },
    };
  };

export const createSessionStore = storeFactory("Session");
export const createAccountStore = storeFactory("Account");

export function getChunkedCookie(
  ctx: AthenaCookieContextRuntime,
  cookieName: string
): string | null {
  const value = ctx.getCookie?.(cookieName);
  if (value) {
    return value;
  }

  const chunks: Array<{ index: number; value: string }> = [];
  const cookieHeader = ctx.headers?.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const [name, parsedValue] of parseCookies(cookieHeader)) {
    if (!name.startsWith(`${cookieName}.`)) {
      continue;
    }
    const parts = name.split(".");
    const indexStr = parts.at(-1);
    const index = Number.parseInt(indexStr || "0", 10);
    if (!Number.isNaN(index)) {
      chunks.push({ index, value: parsedValue });
    }
  }

  if (chunks.length === 0) {
    return null;
  }

  chunks.sort((left, right) => left.index - right.index);
  return chunks.map((entry) => entry.value).join("");
}

/**
 * SDK helper to read an account cookie value.
 * - If plain JSON: returns parsed value.
 * - If base64url-encoded JSON: returns parsed value.
 * - Otherwise: returns the raw cookie string.
 */
export async function getAccountCookie(
  ctx: AthenaCookieContextRuntime,
  cookieName = ctx.context.authCookies.accountData.name
): Promise<unknown | null> {
  const value = getChunkedCookie(ctx, cookieName);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Fall through and try base64url payload parsing.
  }

  try {
    return JSON.parse(decodeBase64UrlToString(value)) as unknown;
  } catch {
    return value;
  }
}
