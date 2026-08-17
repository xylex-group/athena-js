import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { mergeProtectedArtifact } from "../src/generator/artifact-merge.ts";

const generatedDatabase = `import { defineDatabase } from '@xylex-group/athena'

import { athenaSchema } from './schemas/athena'
import { billingSchema } from './schemas/billing'
import { publicSchema } from './schemas/public'

export const railwayDatabase = defineDatabase({
  athena: athenaSchema,
  billing: billingSchema,
  public: publicSchema
})
`;

const generatedRegistry = `import { defineRegistry } from '@xylex-group/athena'
import { railwayDatabase } from './relations'

export const __athena_schema_meta = {
  schemaVersion: 1,
  generatedAt: '2026-07-18T00:00:00.000Z',
  database: 'railway',
  outputPreset: 'athena-direct',
  outputFormat: 'table-builder',
} as const

export const registry = defineRegistry({
  railway: railwayDatabase
})
`;

test("merge database appends missing schema import and entry once", () => {
	const existing = `import { defineDatabase } from "@xylex-group/athena"

import { athenaSchema } from "./schemas/athena"
import { publicSchema } from "./schemas/public"

export const railwayDatabase = defineDatabase({
  athena: athenaSchema,
  public: publicSchema
})
`;

	const first = mergeProtectedArtifact(
		"database",
		existing,
		generatedDatabase,
		"merge",
	);
	assert.equal(first.action, "write");
	assert.equal(first.writeReason, "merged");
	assert.ok(first.content?.includes("billingSchema"));
	assert.ok(first.content?.includes("billing: billingSchema"));
	assert.equal(
		first.added.some((item) => item.includes("billing")),
		true,
	);

	const mergedContent = first.content;
	assert.ok(mergedContent);
	const second = mergeProtectedArtifact(
		"database",
		mergedContent,
		generatedDatabase,
		"merge",
	);
	assert.equal(second.action, "unchanged");
	assert.equal(second.skipReason, "already-current");
});

test("merge database preserves custom exports and reports them", () => {
	const existing = `import { defineDatabase } from '@xylex-group/athena'
import { publicSchema } from './schemas/public'

export const railwayDatabase = defineDatabase({
  public: publicSchema
})

export const handWired = 1
`;

	const result = mergeProtectedArtifact(
		"database",
		existing,
		generatedDatabase,
		"merge",
	);
	assert.equal(result.action, "write");
	assert.ok(result.content?.includes("export const handWired = 1"));
	assert.equal(
		result.preservedCustom.some((item) => item.includes("handWired")),
		true,
	);
});

test("merge database reports conflict when key maps to a different identifier", () => {
	const existing = `import { defineDatabase } from '@xylex-group/athena'
import { publicSchema } from './schemas/public'
import { otherPublic } from './schemas/other'

export const railwayDatabase = defineDatabase({
  public: otherPublic
})
`;

	const result = mergeProtectedArtifact(
		"database",
		existing,
		generatedDatabase,
		"merge",
	);
	// Can still add other missing schemas, but public conflicts
	assert.equal(
		result.conflicts.some((item) => item.includes("public")),
		true,
	);
});

test("merge database skips unparseable content", () => {
	const result = mergeProtectedArtifact(
		"database",
		"// not a database file\n",
		generatedDatabase,
		"merge",
	);
	assert.equal(result.action, "skip");
	assert.equal(result.skipReason, "merge-unparseable");
});

test("merge database skip policy leaves file alone", () => {
	const existing = generatedDatabase;
	const result = mergeProtectedArtifact(
		"database",
		existing,
		generatedDatabase,
		"skip",
	);
	assert.equal(result.action, "skip");
	assert.equal(result.skipReason, "protected-existing-file");
});

test("merge database overwrite policy replaces content", () => {
	const existing = `import { defineDatabase } from '@xylex-group/athena'

export const railwayDatabase = defineDatabase({
})
`;
	const result = mergeProtectedArtifact(
		"database",
		existing,
		generatedDatabase,
		"overwrite",
	);
	assert.equal(result.action, "write");
	assert.equal(result.writeReason, "overwritten");
	assert.equal(result.content, generatedDatabase);
});

test("merge registry adds missing meta fields without bumping generatedAt alone", () => {
	const existing = `import { defineRegistry } from '@xylex-group/athena'
import { railwayDatabase } from './relations'

export const __athena_schema_meta = {
  schemaVersion: 1,
  generatedAt: '2020-01-01T00:00:00.000Z',
  database: 'railway',
  outputFormat: 'table-builder',
} as const

export const registry = defineRegistry({
  railway: railwayDatabase
})
`;

	const result = mergeProtectedArtifact(
		"registry",
		existing,
		generatedRegistry,
		"merge",
	);
	assert.equal(result.action, "write");
	assert.ok(result.content?.includes("outputPreset: 'athena-direct'"));
	// generatedAt should remain until a structural change (only missing keys filled)
	assert.ok(
		result.content?.includes("generatedAt: '2020-01-01T00:00:00.000Z'"),
	);
});

test("merge registry is a no-op when fully current", () => {
	const result = mergeProtectedArtifact(
		"registry",
		generatedRegistry,
		generatedRegistry,
		"merge",
	);
	assert.equal(result.action, "unchanged");
});
