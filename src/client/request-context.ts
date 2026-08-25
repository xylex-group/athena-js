type MaybePromise<T> = T | Promise<T>;

export interface AthenaRequestContext {
	/** Opaque, non-secret access-envelope fingerprint from Auth/Gateway. */
	accessScope?: string | null;
	bearerToken?: string | null;
	cookie?: string | null;
	forceNoCache?: boolean;
	headers?: Record<string, string>;
	organizationId?: string | null;
	policyRevision?: string | null;
	sessionToken?: string | null;
	userId?: string | null;
}

export type AthenaRequestContextProvider = () => MaybePromise<
	AthenaRequestContext | undefined
>;
