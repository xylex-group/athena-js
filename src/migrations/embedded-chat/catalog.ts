import {
	ATHENA_CHAT_RUNTIME_SCHEMA_VERSION,
} from "../../chat/schema-version.ts";

export const EMBEDDED_CHAT_LEDGER = "athena_chat_schema_migrations";

export const EMBEDDED_CHAT_MIGRATIONS = [
	{
		checksum: `chat-runtime-v${ATHENA_CHAT_RUNTIME_SCHEMA_VERSION}`,
		filename: "0001_chat_runtime_v4.sql",
		name: "chat_runtime_v4",
		version: 1,
	},
] as const;
