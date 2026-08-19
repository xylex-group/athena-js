/**
 * Compile-time distinction between the process-wide Athena root and a
 * request-scoped view. Runtime ownership is still enforced via internals.
 */

declare const athenaRootClientBrand: unique symbol;
declare const athenaRequestClientBrand: unique symbol;

/** Phantom brand carried only by `createClient` from `@xylex-group/athena/server`. */
export type AthenaRootClientBrand = {
  readonly [athenaRootClientBrand]: true;
};

/** Phantom brand carried by `withContext` / `createAthenaServerClient` views. */
export type AthenaRequestClientBrand = {
  readonly [athenaRequestClientBrand]: true;
};

export type AthenaRootClient<TClient> = TClient & AthenaRootClientBrand;

/**
 * Request views borrow the root. They keep the query surface and must not
 * expose `close()` — only the root owns lifecycle.
 */
export type AthenaRequestClient<TClient> = Omit<TClient, "close"> &
  AthenaRequestClientBrand;
