export const CLI_JSON_SCHEMA_VERSION = 1 as const;

export type CliOutputFormat = "text" | "json" | "ndjson";

export type CliVerbosity = "quiet" | "normal" | "verbose" | "debug";
