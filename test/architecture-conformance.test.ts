import { strict as assert } from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
	ATHENA_GENERATED_ROOT,
	defineAthenaConfig,
	generateArtifactsFromSnapshot,
} from "../src/generator/index.ts";
import type { IntrospectionSnapshot } from "../src/schema/index.ts";

const snapshot: IntrospectionSnapshot = {
	backend: "postgresql",
	database: "app_db",
	generatedAt: new Date("2026-06-16T00:00:00.000Z").toISOString(),
	schemas: {
		public: {
			name: "public",
			tables: {
				users: {
					columns: {
						id: {
							arrayDimensions: 0,
							dataType: "uuid",
							hasDefault: false,
							isGenerated: false,
							isNullable: false,
							isPrimaryKey: true,
							name: "id",
							typeKind: "scalar",
							udtName: "uuid",
						},
					},
					name: "users",
					primaryKey: ["id"],
					relations: {},
					schema: "public",
				},
			},
		},
	},
};

function directConfig(preset: "athena-direct" | "legacy" = "athena-direct") {
	return defineAthenaConfig({
		provider: {
			kind: "postgres",
			mode: "direct",
			connectionString: "postgres://localhost/app_db",
			schemas: ["public"],
		},
		output: {
			format: "table-builder",
			preset,
		},
	});
}

/** ACT-003: generated isolation under src/lib/athena/generated */
test("ACT-003 generated outputs only under src/lib/athena/generated", () => {
	const artifacts = generateArtifactsFromSnapshot(snapshot, directConfig());
	assert.ok(artifacts.files.length > 0);
	for (const file of artifacts.files) {
		const normalized = file.path.replace(/\\/g, "/");
		assert.equal(
			normalized.startsWith(`${ATHENA_GENERATED_ROOT}/`),
			true,
			`path outside generated root: ${file.path}`,
		);
	}
	assert.equal(
		artifacts.files.some((f) =>
			f.path.replace(/\\/g, "/").endsWith("registry.ts"),
		),
		true,
	);
	assert.equal(
		artifacts.files.some((f) =>
			f.path.replace(/\\/g, "/").includes("/models/"),
		),
		true,
	);
});

/** ACT-007: deterministic emit (normalized) */
test("ACT-007 generateArtifactsFromSnapshot is deterministic", () => {
	const config = directConfig();
	const a = generateArtifactsFromSnapshot(snapshot, config);
	const b = generateArtifactsFromSnapshot(snapshot, config);
	assert.deepEqual(
		a.files.map((f) => ({ path: f.path, content: f.content })),
		b.files.map((f) => ({ path: f.path, content: f.content })),
	);
});

/** ACT-009: athena-js package surface has no project mutators */
test("ACT-009 athena-js source has no scaffold/doctor/migrate mutators", async () => {
	const root = join(process.cwd(), "src");
	async function walk(dir: string): Promise<string[]> {
		const entries = await readdir(dir, { withFileTypes: true });
		const out: string[] = [];
		for (const e of entries) {
			const p = join(dir, e.name);
			if (e.isDirectory()) out.push(...(await walk(p)));
			else if (e.name.endsWith(".ts")) out.push(p);
		}
		return out;
	}
	const files = await walk(root);
	const banned =
		/\b(scaffoldProject|runDoctor|applyCodemod|mutateProject|writeScaffoldManifest)\b/;
	for (const file of files) {
		const text = await readFile(file, "utf8");
		assert.equal(
			banned.test(text),
			false,
			`forbidden project-mutator symbol in ${file}`,
		);
	}
});

test("ACT-012 legacy preset still emits N-1 root athena/*", () => {
	const artifacts = generateArtifactsFromSnapshot(
		snapshot,
		directConfig("legacy"),
	);
	assert.equal(
		artifacts.files.some((f) =>
			f.path.replace(/\\/g, "/").startsWith("athena/"),
		),
		true,
	);
	assert.equal(
		artifacts.files.some((f) =>
			f.path.replace(/\\/g, "/").startsWith("src/lib/athena/generated/"),
		),
		false,
	);
});
