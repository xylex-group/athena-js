import { normalizeMollieBillingProviderConfig } from "../config.ts";
import type {
	MollieBillingProviderConfig,
	NormalizedMollieBillingProviderConfig,
} from "../../../../providers/types.ts";

function isNormalizedMollieConfig(
	config: MollieBillingProviderConfig | NormalizedMollieBillingProviderConfig,
): config is NormalizedMollieBillingProviderConfig {
	return "provider" in config && config.provider === "mollie";
}

export function normalizeMollieRuntimeConfig(
	config: MollieBillingProviderConfig | NormalizedMollieBillingProviderConfig,
): NormalizedMollieBillingProviderConfig {
	if (isNormalizedMollieConfig(config)) {
		return config;
	}
	return normalizeMollieBillingProviderConfig(config);
}
