import { ATHENA_CHAT_RUNTIME_SCHEMA_VERSION } from "../../chat/schema-version.ts";
import { checksumMigrationSql } from "../checksum.ts";
import chatRuntimeV4Sql from "./sql/0001_chat_runtime_v4.sql";

export const EMBEDDED_CHAT_LEDGER = "athena_chat_schema_migrations";

export const EMBEDDED_CHAT_REQUIRED_TABLES = [
  "files",
  "chat_rooms",
  "chat_direct_rooms",
  "chat_room_members",
  "chat_messages",
  "chat_message_attachments",
  "chat_message_reactions",
  "chat_outbox",
  "runtime_schema_versions",
] as const;

export const EMBEDDED_CHAT_REQUIRED_RELATIONS =
  EMBEDDED_CHAT_REQUIRED_TABLES.map((table) => ({ schema: "athena", table }));

export const EMBEDDED_CHAT_LEGACY_CHECKSUMS_V1 = ["chat-runtime-v4"] as const;

export const EMBEDDED_CHAT_MIGRATIONS = [
  {
    checksum: checksumMigrationSql(chatRuntimeV4Sql),
    filename: "0001_chat_runtime_v4.sql",
    legacyChecksums: EMBEDDED_CHAT_LEGACY_CHECKSUMS_V1,
    name: "chat_runtime_v4",
    requiredRelations: EMBEDDED_CHAT_REQUIRED_RELATIONS,
    schemaVersion: ATHENA_CHAT_RUNTIME_SCHEMA_VERSION,
    sql: chatRuntimeV4Sql,
    version: 1,
  },
] as const;
