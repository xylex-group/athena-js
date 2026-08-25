/**
 * PR F target — schema diff --policy-impact reports authored policies
 * impacted by dropped/renamed tables/columns (GREEN).
 * Characterization retired to
 * test/sdd/superseded/athena-schema-policy-impact.baseline.superseded.ts
 *
 * See docs/sdd/xylex/athena-policy/SPEC.md and dual-suite/dual-suite-spec.md.
 */
import { strict as assert } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { schemaCatalog } from "../../src/cli/commands/schema/catalog.ts";
import { parse } from "../../src/cli/commands/schema/index.ts";
import { runSchemaDiff } from "../../src/cli/commands/schema/run.ts";
import type { SchemaDiffCommand } from "../../src/cli/types.ts";
import { definePolicies, policy } from "../../src/policy/index.ts";
import {
	ATHENA_SCHEMA_SNAPSHOT_VERSION,
	type AthenaSchemaSnapshot,
	type SchemaColumn,
	type SchemaTable,
	diffSchemas,
	normalizeSchemaSnapshot,
	parseSchemaTypeString,
} from "../../src/schema/diff/index.ts";
import { string, table as defineTable } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
	return readFileSync(join(srcRoot, rel), "utf8");
}

function col(
	name: string,
	typeName: string,
	opts: Partial<SchemaColumn> = {},
): SchemaColumn {
	return {
		name,
		type: parseSchemaTypeString(typeName, 0),
		nullable: opts.nullable ?? false,
		default: opts.default ?? null,
		isGenerated: opts.isGenerated ?? false,
	};
}

function schemaTable(
	schema: string,
	name: string,
	columns: SchemaColumn[],
): SchemaTable {
	return {
		schema,
		name,
		columns,
		primaryKey: { name: null, columns: ["id"] },
		uniqueConstraints: [],
		foreignKeys: [],
		indexes: [],
	};
}

function snap(tables: SchemaTable[]): AthenaSchemaSnapshot {
	const bySchema = new Map<string, SchemaTable[]>();
	for (const item of tables) {
		const list = bySchema.get(item.schema) ?? [];
		list.push(item);
		bySchema.set(item.schema, list);
	}
	return normalizeSchemaSnapshot({
		version: ATHENA_SCHEMA_SNAPSHOT_VERSION,
		backend: "postgresql",
		schemas: [...bySchema.entries()].map(([schemaName, schemaTables]) => ({
			name: schemaName,
			tables: schemaTables,
		})),
	});
}

type PolicyImpactHit = {
	policyId: string;
	resource?: string;
	table?: string;
	model?: string;
	operations?: string[];
};

const invoices = defineTable("invoices")
	.schema("public")
	.columns({
		amount: string(),
		id: string().generated(),
		userId: string().from("user_id"),
	})
	.primaryKey("id");

test("P?: schema diff --policy-impact reports authored policies by model/table for dropped/renamed tables/columns", async () => {
	const typesSrc = readSrc("cli/types.ts");
	const start = typesSrc.indexOf("export interface SchemaDiffCommand");
	const end = typesSrc.indexOf("export interface SchemaSnapshotCommand");
	assert.ok(start >= 0 && end > start);
	const block = typesSrc.slice(start, end);
	assert.match(block, /policyImpact/);

	const parsed = parse(["diff", "--policy-impact"]) as SchemaDiffCommand & {
		policyImpact?: boolean;
	};
	assert.equal(parsed.command, "schema-diff");
	assert.equal(parsed.policyImpact, true);

	const withJson = parse([
		"diff",
		"--json",
		"--policy-impact",
	]) as SchemaDiffCommand & { policyImpact?: boolean };
	assert.equal(withJson.json, true);
	assert.equal(withJson.policyImpact, true);

	const diffEntry = schemaCatalog.find((entry) => entry.command === "schema diff");
	assert.ok(diffEntry);
	assert.ok(diffEntry.flags?.includes("--policy-impact"));

	const parseSrc = readSrc("cli/commands/schema/index.ts");
	assert.match(parseSrc, /policy-impact|policyImpact/);
	const runSrc = readSrc("cli/commands/schema/run.ts");
	assert.match(runSrc, /policyImpact/);
	assert.equal(runSrc.includes("createClient"), false);

	const from = snap([
		schemaTable("public", "invoices", [
			col("id", "uuid"),
			col("user_id", "text"),
			col("amount", "text"),
		]),
		schemaTable("public", "legacy_notes", [
			col("id", "uuid"),
			col("body", "text"),
		]),
	]);
	const to = snap([
		schemaTable("public", "bills", [
			col("id", "uuid"),
			col("amount", "text"),
		]),
	]);
	const diff = diffSchemas({ from, to });
	const kinds = new Set(diff.operations.map((op) => op.kind));
	assert.ok(kinds.has("drop_table") || kinds.has("rename_table"));
	assert.ok(kinds.has("drop_column") || kinds.has("rename_column") || kinds.has("rename_table"));

	const authored = definePolicies([
		policy(invoices, {
			id: "users-see-own-invoices",
			select: {
				to: ["authenticated"],
				allow: ({ row, auth }) => row.userId.eq(auth.userId),
			},
		}),
	]);

	const root = mkdtempSync(join(tmpdir(), "athena-schema-policy-impact-"));
	try {
		const fromPath = join(root, "athena", "schema.snapshot.json");
		mkdirSync(dirname(fromPath), { recursive: true });
		writeFileSync(`${fromPath}`, `${JSON.stringify(from, null, 2)}\n`, "utf8");
		writeFileSync(
			join(root, "athena.config.ts"),
			`
export default {
  policies: { definitions: [] },
  tooling: { policies: "./policies.ts" },
};
`,
			"utf8",
		);

		const report = (await runSchemaDiff({
			cwd: root,
			fromPath,
			inspect: async () => to,
			policyImpact: true,
			policies: authored,
		} as never)) as {
			policyImpact?: PolicyImpactHit[];
			diff: { operations: Array<{ kind: string }> };
		};
		assert.ok(Array.isArray(report.policyImpact));
		assert.ok(report.policyImpact.length > 0);
		const hit = report.policyImpact.find(
			(item) =>
				item.policyId === "users-see-own-invoices" ||
				String(item.table ?? item.resource ?? item.model ?? "").includes(
					"invoices",
				),
		);
		assert.ok(hit, "impact report must name the authored invoices policy");
		const tableRef = String(hit.table ?? hit.resource ?? hit.model ?? "");
		assert.match(tableRef, /invoices/);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
