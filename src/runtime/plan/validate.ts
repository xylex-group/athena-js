/**
 * Fail closed on conflicting local/remote runtime intent.
 */

import { AthenaConfigurationError } from "../../config/errors.ts";
import type { AthenaRuntimePlan } from "./types.ts";

export function validateRuntimePlan(plan: unknown): AthenaRuntimePlan {
	if (!plan || typeof plan !== "object") {
		throw new AthenaConfigurationError(
			"ATHENA_RUNTIME_CONFIG_INVALID",
			"AthenaRuntimePlan is missing; construction cannot continue.",
		);
	}
	const next = plan as AthenaRuntimePlan;
	const storage = next.storage;
	if (
		storage?.wantsLocal &&
		(storage.hasUrl || storage.hasR2 || storage.wantsS3)
	) {
		throw new AthenaConfigurationError(
			"ATHENA_RUNTIME_CONFIG_INVALID",
			'storage.provider "local" cannot be combined with storage.url, storage.r2, or storage.provider "s3". Embedded ObjectStore and managed HTTP/R2/S3 are separate modes.',
			"storage",
		);
	}
	if (
		storage?.wantsS3 &&
		(storage.hasUrl || storage.hasR2 || storage.wantsLocal || storage.root)
	) {
		throw new AthenaConfigurationError(
			"ATHENA_RUNTIME_CONFIG_INVALID",
			'storage.provider "s3" cannot be combined with storage.url, storage.r2, or a local filesystem root. Direct S3 and other storage modes are exclusive.',
			"storage",
		);
	}
	if (next.db?.hasD1 && (next.db.pgUri || next.db.hasPool)) {
		throw new AthenaConfigurationError(
			"ATHENA_NO_SERVICE_CONFIGURED",
			"Athena cannot use db.d1 and db.pgUri together. Configure exactly one local DB binding, or set mode/prefer to select a single execution backend.",
			"db",
		);
	}
	return next;
}
