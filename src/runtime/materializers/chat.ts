/**
 * Node chat materializer — local chat runtime + borrowed Postgres store.
 */

import { resolveChatMode } from "../../chat/config.ts";
import { createChatDatabaseFromRuntime } from "../../chat/local/database.ts";
import { createRootChatPrincipalResolver } from "../../chat/local/principal.ts";
import { createLocalChatRuntime } from "../../chat/local/runtime.ts";
import {
	bindPostgresRuntime,
	createAthenaPostgresRuntime,
	getBoundPostgresRuntime,
} from "../../postgres/owned-runtime.ts";
import type { AthenaClientModelsInput } from "../../schema/types.ts";
import {
	type AthenaClientConfig,
	normalizeOptional,
} from "../../v3-client-core.ts";
import type { AthenaRuntimePlan } from "../plan/types.ts";

export function plantLocalChatRuntime<
	TModels extends AthenaClientModelsInput | undefined,
>(config: AthenaClientConfig<TModels>): AthenaClientConfig<TModels> {
	if (config.chatRuntime) {
		return config;
	}
	if (config.chat === undefined || config.chat === false) {
		return config;
	}
	const pgUri =
		normalizeOptional(config.db?.pgUri) ??
		normalizeOptional(config.databaseUrl);
	const mode = resolveChatMode({
		chat: config.chat,
		clusterUrl: config.url,
		databaseUrl: pgUri,
	});
	if (mode !== "local") {
		return config;
	}
	if (!pgUri) {
		return config;
	}
	const postgresRuntime =
		getBoundPostgresRuntime(config.gatewayTransport) ??
		createAthenaPostgresRuntime({ connectionString: pgUri });
	if (config.gatewayTransport) {
		bindPostgresRuntime(config.gatewayTransport, postgresRuntime);
	}
	const chatObject =
		typeof config.chat === "object" && config.chat ? config.chat : undefined;
	return {
		...config,
		chatRuntime: createLocalChatRuntime({
			database: createChatDatabaseFromRuntime(postgresRuntime),
			resolvePrincipal: createRootChatPrincipalResolver({
				auth: config.auth,
				context: config.context,
				databaseUrl: pgUri,
				resolvePrincipal: chatObject?.resolvePrincipal,
			}),
		}),
	};
}

export function materializeChat<
	TModels extends AthenaClientModelsInput | undefined,
>(
	config: AthenaClientConfig<TModels>,
	_plan?: AthenaRuntimePlan,
): AthenaClientConfig<TModels> {
	return plantLocalChatRuntime(config);
}
