import {
	type AthenaClient,
	type AthenaClientConfig,
	type AthenaRequestContext,
	createClient,
	defineModel,
	string,
	table,
} from "../src/index.ts";
import { createAthenaBrowserClient } from "../src/next/client.ts";
import {
	createAthenaServerClient,
	resolveNextRequestContext,
} from "../src/next/server.ts";

const userModel = defineModel<
	{ id: string; email: string; created_at: string },
	{ email: string },
	{ email?: string }
>({
	meta: {
		nullable: { created_at: false, email: false, id: false },
		primaryKey: ["id"],
	},
});

const models = {
	app: {
		schemas: {
			public: {
				models: {
					users: userModel,
				},
			},
		},
	},
};

const context: AthenaRequestContext = {
	headers: { "X-Company-Id": "company_1" },
	organizationId: "org_1",
	userId: "user_1",
};

const disabledAuthOnly: AthenaClientConfig = {
	auth: false,
	db: { pgUri: "postgres://example.invalid/app" },
};
// @ts-expect-error auth:false cannot carry url / mode fields
void disabledAuthOnly.auth.url;

// Local Auth root (next-minimal): autoMigrate is a public createClient field.
const localAuthRoot: AthenaClientConfig = {
	auth: {
		autoMigrate: true,
		mode: "local",
	},
	databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena",
};
void createClient(localAuthRoot);
type AthenaAuthConfigKeys =
	keyof import("../src/v3-client-core.ts").AthenaAuthConfig;
void ("autoMigrate" satisfies AthenaAuthConfigKeys);

const config: AthenaClientConfig<typeof models> = {
	auth: { credentials: "include" },
	chat: { wsUrl: "wss://athena.example.com/wss/gateway" },
	context: async () => context,
	db: { pgUri: "postgres://example.invalid/app" },
	debugAst: true,
	findManyAst: true,
	key: "test-key",
	models,
	retryReads: true,
	storage: {},
	traceQueries: true,
	url: "https://athena.example.com",
};

// Avoid direct AthenaClient<typeof models> assignment at the createClient call:
// nested model registries overflow TS instantiation depth (TS2589). Cast after
// the call so the rest of this file still exercises the public surface.
const client = createClient(
	config as unknown as AthenaClientConfig,
) as unknown as AthenaClient<typeof models>;
const scoped = client.withContext(context) as unknown as AthenaClient<
	typeof models
>;

// Storage-enabled clients expose both presigned URL and binary proxy reads.
void client.storage.getStorageFileUrl("file_1", { purpose: "download" });
void client.storage.getStorageFileProxy("file_1", { purpose: "stream" });
// file facade mirrors the proxy route without replacing getStorageFileUrl.
void client.storage.file.proxy("file_1", { purpose: "read" });

void scoped.from(userModel).select("id,email");
void scoped.from("users").select("id,email");
// @ts-expect-error known models reject unknown columns
void scoped.from("users").select("missing_column");
// findMany object-select uses the same model column typechecking
void scoped.from("users").findMany({
	limit: 1,
	select: {
		created_at: true,
		email: true,
		id: true,
	},
});
void scoped.from(userModel).findMany({
	select: {
		email: true,
		id: true,
	},
});
void scoped.from("users").findMany({
	select: {
		// @ts-expect-error known models reject unknown findMany select keys
		missing_column: true,
	},
});

const dynamic = createClient({
	key: "test-key",
	url: "https://athena.example.com",
});
void dynamic
	.from<{ runtime_column: string }>("runtime_table")
	.select("runtime_column");
void dynamic.from<{ runtime_column: string }>("runtime_table").findMany({
	select: {
		runtime_column: true,
	},
});
// free-form tables remain untyped for findMany select keys
void dynamic.from("runtime_table").findMany({
	select: {
		any_column: true,
	},
});
void resolveNextRequestContext({
	requestHeaders: { cookie: "athena-auth.session-token=test" },
});

const browserClient = createAthenaBrowserClient({
	key: "publishable_key",
	models,
	url: "https://athena.example.com",
});
void browserClient.from("users").select("id,email");
// @ts-expect-error known models reject unknown columns on browser factory clients
void browserClient.from("users").select("missing_column");
void browserClient.from("users").findMany({
	select: {
		email: true,
		id: true,
	},
});
void browserClient.from("users").findMany({
	select: {
		// @ts-expect-error known models reject unknown findMany select keys on browser factory
		missing_column: true,
	},
});
createAthenaBrowserClient({
	// @ts-expect-error browser factory config omits env
	env: process.env,
	key: "publishable_key",
	url: "https://athena.example.com",
});
createAthenaBrowserClient({
	// @ts-expect-error browser factory config omits request context
	context: { userId: "x" },
	key: "publishable_key",
	url: "https://athena.example.com",
});

// Layered { client } boundary must stay shallow: a strongly typed root's
// withContext return (narrow table unions) must assign without comparing the
// full AthenaClient database surface (otherwise TS2589 / assignability errors).
declare const typedLayeredRoot: {
	withContext: (context: AthenaRequestContext) => {
		from: (table: "users") => { select: (cols: string) => Promise<unknown> };
	};
};
void (async () => {
	const layered = await createAthenaServerClient({
		client: typedLayeredRoot,
		requestCookies: "",
		requestHeaders: {},
	});
	void layered;
})();

const serverClient = await createAthenaServerClient({
	env: process.env,
	models,
	requestCookies: "",
	requestHeaders: {},
});
void serverClient.from("users").select("id,email");
// @ts-expect-error known models reject unknown columns on server factory clients
void serverClient.from("users").select("missing_column");
void serverClient.from("users").findMany({
	select: {
		created_at: true,
		email: true,
		id: true,
	},
});
void serverClient.from("users").findMany({
	select: {
		// @ts-expect-error known models reject unknown findMany select keys on server factory
		missing_column: true,
	},
});
// @ts-expect-error server factory requires url+key, env, databaseUrl, or client
void createAthenaServerClient({});
void createAthenaServerClient({
	databaseUrl: "postgresql://postgres@127.0.0.1:5432/athena",
});

const usersTable = table("users")
	.schema("public")
	.columns({
		email: string(),
		id: string(),
	})
	.primaryKey("id");

void scoped.from(usersTable).select("id,email");
void browserClient.from(usersTable).select("id,email");
void serverClient.from(usersTable).select("id,email");
// @ts-expect-error table targets reject unknown columns
void scoped.from(usersTable).select("missing_column");

// @ts-expect-error positional construction was removed in v3
createClient("https://athena.example.com", "test-key");
// Removed v3 config keys must not appear on AthenaClientConfig
type AthenaClientConfigKeys =
	keyof import("../src/v3-client.ts").AthenaClientConfig;
// @ts-expect-error the v3 config has no experimental bag
void ("experimental" satisfies AthenaClientConfigKeys);
// @ts-expect-error typecheckColumns was removed
void ("typecheckColumns" satisfies AthenaClientConfigKeys);
// @ts-expect-error flat service aliases were removed
createClient({ gatewayUrl: "https://athena.example.com/db", key: "test-key" });

// billing namespace is always present on the public client type surface
void client.billing.getCapabilities;

// Execution mode is a closed alias union (`AthenaExecutionMode | string` collapsed to string).
void createClient({
	key: "test-key",
	mode: "auto",
	url: "https://athena.example.com",
});
void createClient({
	d1: { prepare() {} } as never,
	mode: "d1",
});
// @ts-expect-error empty execution mode is not a valid AthenaExecutionModeInput
createClient({ mode: "" });
// @ts-expect-error unknown execution mode is not a valid AthenaExecutionModeInput
createClient({ mode: "postgres" });
createClient({
	key: "test-key",
	// @ts-expect-error empty prefer is not a valid AthenaExecutionPreferInput
	prefer: "",
	url: "https://athena.example.com",
});
