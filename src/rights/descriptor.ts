import type { AthenaRightKey } from "./key.ts";

/**
 * Catalog metadata for a Right. Fields come from the Rust catalog
 * (`crates/athena-rights`); they are not reconstructed from key syntax.
 */
export type AthenaRightDescriptor = {
	action: string;
	description: string;
	isPattern: boolean;
	key: AthenaRightKey;
	kind: string;
	resource: string;
	source: string;
};
