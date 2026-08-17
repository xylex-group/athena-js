/**
 * Minimal shims so the fixture can typecheck without installing Next.js.
 * Production apps resolve these from the real `next` / `server-only` packages.
 */
declare module "next/headers" {
  export interface ReadonlyHeaders {
    get: (name: string) => string | null;
  }

  export interface ReadonlyRequestCookies {
    getAll: () => Array<{ name: string; value: string }>;
  }

  export function headers(): Promise<ReadonlyHeaders>;
  export function cookies(): Promise<ReadonlyRequestCookies>;
}

declare module "server-only";
