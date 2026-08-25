/**
 * Public Athena DevTools protocol types (snapshot, events, panels, provenance, drift).
 *
 * Settings record configured vs inferred vs effective + source.
 * Provenance stages: source → normalization → inference → runtime.
 */

export const ATHENA_DEVTOOLS_PROTOCOL_VERSION = 1 as const;

export const ATHENA_DEVTOOLS_REQUEST_HEADER = "x-athena-devtools";
export const ATHENA_DEVTOOLS_TRACE_HEADER = "x-athena-trace-id";
export const ATHENA_DEVTOOLS_REQUEST_ID_HEADER = "x-athena-request-id";
/** Retired bulky transport. Mutation responses must not set this header. */
export const ATHENA_DEVTOOLS_DATA_HEADER = "x-athena-data-nucleus";

export const ATHENA_DEVTOOLS_EVENTS_PATH = "/api/athena/devtools/v1/events";
export const ATHENA_DEVTOOLS_STREAM_PATH = "/api/athena/devtools/v1/stream";

export const ATHENA_DEVTOOLS_PANEL_IDS = [
	"overview",
	"runtime",
	"configuration",
	"models",
	"migrations",
	"data",
	"queries",
	"policy",
	"auth",
	"storage",
	"billing",
	"network",
	"traces",
	"packages",
	"diagnostics",
] as const;

export type AthenaDevtoolsPanelId = (typeof ATHENA_DEVTOOLS_PANEL_IDS)[number];

export type AthenaDevtoolsPanelPhase = "P0" | "P1" | "P2";

export type AthenaDevtoolsPanelStatus = "ready" | "stub";

export type AthenaDevtoolsPanelEntry = {
	panelId: AthenaDevtoolsPanelId;
	phase: AthenaDevtoolsPanelPhase;
	status: AthenaDevtoolsPanelStatus;
};

export type AthenaDevtoolsDriftKind =
	| "model-drift"
	| "missing-table"
	| "missing-column"
	| "type-mismatch"
	| "unapplied-migration"
	| "orphan-column";

export type AthenaDevtoolsMigrationGeneratedBy =
	| "Manual"
	| "Auth"
	| "Billing"
	| "Storage";

export type AthenaDevtoolsPresence = "set" | "unset";

export type AthenaDevtoolsInferredPresence =
	| AthenaDevtoolsPresence
	| "not-applicable";

export type AthenaDevtoolsSettingSource =
	| "athena.config.ts"
	| "createClient"
	| "env"
	| "trustedOrigins"
	| "localhost-dev-default"
	| "runtime-plan"
	| "unset";

export type AthenaDevtoolsRedactedFact =
	| { kind: "structural"; value: string | boolean | number | null }
	| { kind: "secret"; configured: boolean }
	| { kind: "unset" };

export type AthenaDevtoolsSettingProvenance = {
	path: string;
	configured: AthenaDevtoolsPresence;
	inferred: AthenaDevtoolsInferredPresence;
	effective: AthenaDevtoolsPresence;
	source: AthenaDevtoolsSettingSource;
	stages: {
		source: AthenaDevtoolsRedactedFact;
		normalization: AthenaDevtoolsRedactedFact;
		inference: AthenaDevtoolsRedactedFact;
		runtime: AthenaDevtoolsRedactedFact;
	};
};

export type AthenaDevtoolsDataTimings = {
	afterHooksMs: number | null;
	authorizeMs: number | null;
	beforeHooksMs: number | null;
	executeMs: number | null;
	prepareMs: number | null;
	totalMs: number | null;
};

export type AthenaDevtoolsDataEvent = {
	affectedRows: number | null;
	errorPhase: string | null;
	event: string;
	eventId: string | null;
	operation: string;
	policyIds: string[] | null;
	policyOutcome: string | null;
	principal: {
		authority: string | null;
	};
	requestId: string | null;
	resource: string | null;
	timings: AthenaDevtoolsDataTimings;
	traceId: string | null;
	transactionSemantics: "atomic" | "backend-managed" | "unknown" | null;
};

export type AthenaDevtoolsModelField = {
	name: string;
	type: string;
};

export type AthenaDevtoolsModelRelation = {
	kind: string;
	name: string;
	targetModel: string;
};

export type AthenaDevtoolsModelTable = {
	fields: AthenaDevtoolsModelField[];
	identity: string;
	name: string;
	primaryKey: string[];
	relations: AthenaDevtoolsModelRelation[];
	schema: string;
	schemaTable: string;
	table: string;
};

export type AthenaDevtoolsDriftEntry = {
	kind: AthenaDevtoolsDriftKind;
	object: string;
};

export type AthenaDevtoolsModelsInspector = {
	drift: AthenaDevtoolsDriftEntry[];
	liveCatalog: "available" | "unavailable";
	tables: AthenaDevtoolsModelTable[];
};

export type AthenaDevtoolsMigrationRecord = {
	filename?: string;
	generatedBy: AthenaDevtoolsMigrationGeneratedBy;
	name?: string;
	version?: number;
};

export type AthenaDevtoolsMigrationSubsystemStatus = {
	generatedBy: AthenaDevtoolsMigrationGeneratedBy;
	status: "applied" | "pending" | "unknown" | "drift";
};

export type AthenaDevtoolsMigrationsInspector = {
	applied: AthenaDevtoolsMigrationRecord[];
	files: AthenaDevtoolsMigrationRecord[];
	generatedBy: AthenaDevtoolsMigrationGeneratedBy[];
	latestApplied: string | number | null;
	localFileCount: number;
	pending: AthenaDevtoolsMigrationRecord[];
	schemaVersion: number;
	subsystems: {
		auth: AthenaDevtoolsMigrationSubsystemStatus;
		billing: AthenaDevtoolsMigrationSubsystemStatus;
		storage: AthenaDevtoolsMigrationSubsystemStatus;
	};
	version: number;
};

export type AthenaDevtoolsSnapshot = {
	configuration: {
		settings: AthenaDevtoolsSettingProvenance[];
	};
	migrations: AthenaDevtoolsMigrationsInspector;
	models: AthenaDevtoolsModelsInspector;
	overview: {
		protocolVersion: typeof ATHENA_DEVTOOLS_PROTOCOL_VERSION;
	};
	panels: AthenaDevtoolsPanelEntry[];
	protocolVersion: typeof ATHENA_DEVTOOLS_PROTOCOL_VERSION;
};
