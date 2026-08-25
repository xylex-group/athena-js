export interface AthenaAuthenticatorMetadata {
	aaguid: string;
	displayName?: string;
	model?: string;
	vendor?: string;
}

export type AthenaPasskeyDiscoverability =
	| "discoverable"
	| "non-discoverable"
	| "unknown";

export interface AthenaPasskeyDisplayNameInput {
	aaguid?: string | null;
	backedUp?: boolean;
	deviceType?: "multiDevice" | "singleDevice";
	name?: string | null;
	residentKey?: boolean | null;
	transports?: readonly string[] | null;
}

export interface AthenaPasskeyDisplayName {
	discoverability?: AthenaPasskeyDiscoverability;
	displayName: string;
	model?: string;
	vendor?: string;
}
