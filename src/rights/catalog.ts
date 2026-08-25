import type { AthenaRightDescriptor } from "./descriptor.ts";
import { parseAthenaRightKey } from "./key.ts";

/**
 * Wire shape for a catalog descriptor (gateway JSON / generated fixtures).
 * Native catalog bytes live in Rust; this module only projects already-authored
 * descriptor documents and never owns a TypeScript native table.
 */
export type AthenaRightDescriptorWire = {
	action: string;
	description: string;
	isPattern: boolean;
	key: string;
	kind: string;
	resource: string;
	source: string;
};

/** Parse a wire descriptor. `resource` / `action` are taken from the document. */
export function descriptorFromWire(
	wire: AthenaRightDescriptorWire,
): AthenaRightDescriptor {
	return {
		action: wire.action,
		description: wire.description,
		isPattern: wire.isPattern,
		key: parseAthenaRightKey(wire.key),
		kind: wire.kind,
		resource: wire.resource,
		source: wire.source,
	};
}

export function descriptorsFromWire(
	wires: readonly AthenaRightDescriptorWire[],
): AthenaRightDescriptor[] {
	return wires.map(descriptorFromWire);
}
