import type { AthenaRightContribution } from "../../rights/contribution.ts";
import { resolveAthenaRightsIr } from "../../rights/resolver.ts";
import type {
	AthenaRightDefinition,
	AthenaRightsIr,
	AthenaRightsMetadata,
} from "../../rights/types.ts";

export type AthenaApplicationRightInput =
	| AthenaRightDefinition
	| AthenaRightContribution;

function isRightContribution(
	value: AthenaApplicationRightInput,
): value is AthenaRightContribution {
	return (
		typeof value === "object" &&
		value !== null &&
		"definition" in value &&
		"source" in value
	);
}

function requiredSource(source: string | undefined): string {
	if (!(source && source.trim())) {
		throw new Error(
			"Athena application right contributions require a non-empty source",
		);
	}
	return source;
}

export function toAthenaApplicationRightContributions(
	input: readonly AthenaApplicationRightInput[],
	source?: string,
): readonly AthenaRightContribution[] {
	return Object.freeze(
		input.map((entry) => {
			if (isRightContribution(entry)) {
				return {
					definition: entry.definition,
					source: entry.source,
				};
			}
			return {
				definition: entry,
				source: requiredSource(source),
			};
		}),
	);
}

export function resolveAthenaApplicationRightsIr(
	input: readonly AthenaApplicationRightInput[],
	source?: string,
	metadata: AthenaRightsMetadata = {},
): AthenaRightsIr {
	return resolveAthenaRightsIr(
		toAthenaApplicationRightContributions(input, source),
		metadata,
	);
}
