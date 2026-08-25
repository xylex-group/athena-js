import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import { AthenaCliError, formatAthenaCliError } from "../src/cli/errors.ts";
import { colorizeTaggedLine, createCliUi, styleHelpText } from "../src/cli/ui/index.ts";
import { statusLabel, statusPhrase } from "../src/cli/ui/symbols.ts";
import type { MigrationReportView } from "../src/cli/ui/types.ts";

const report: MigrationReportView = {
	application: {
		rows: [
			{ name: "0001_forms_bootstrap.sql", status: "applied" },
			{ name: "0002_form_schema_revision.sql", status: "checksum-mismatch" },
			{ name: "0005_settings_notifications.sql", status: "pending" },
		],
		summary: "1 applied · 1 pending · 1 conflicts",
		title: "Application",
	},
	auth: {
		rows: [{ name: "001_create_core_tables", status: "pending" }],
		summary: "0 applied · 1 pending · 0 conflicts",
		title: "Embedded Auth",
	},
	diagnostics: [
		{
			level: "error",
			message:
				"Migration integrity error\n\n0002_form_schema_revision.sql was already applied but its contents have changed.",
			hint: "Create a new forward migration instead of editing an applied file.",
		},
	],
	outcome: "Application migration history has conflicts.",
	target: {
		database: "neondb",
		directory: "athena/migrations",
		provider: "postgres/direct",
	},
	title: "Athena JS · migrations",
};

test("status phrases are human-readable on TTY", () => {
	assert.equal(statusPhrase("checksum-mismatch"), "checksum mismatch");
	assert.equal(statusPhrase("missing-local"), "missing locally");
	assert.equal(statusLabel("checksum-mismatch", true), "✗ checksum mismatch");
	assert.equal(statusLabel("checksum-mismatch", false), "[checksum-mismatch]");
});

test("plain migrate status aligns target keys and human status labels", () => {
	const lines: string[] = [];
	const ui = createCliUi({
		capabilities: {
			color: false,
			isTty: true,
			mode: "interactive",
			quiet: false,
			verbose: false,
		},
		write: (message) => {
			lines.push(message);
		},
	});
	ui.renderMigrationReport(report);
	const text = lines.join("\n");
	assert.match(text, /Athena JS · migrations/);
	assert.match(text, /┌/);
	assert.match(text, /│/);
	assert.match(text, /└/);
	assert.match(text, /Provider\s+postgres\/direct/);
	assert.match(text, /Database\s+neondb/);
	assert.match(text, /✗ checksum mismatch/);
	assert.match(text, /○ pending/);
	assert.match(text, /✓ applied/);
	assert.match(text, /Application migration history has conflicts/);
	assert.match(text, /Create a new forward migration/);
});

test("plain --plain keeps machine status tokens", () => {
	const lines: string[] = [];
	const ui = createCliUi({
		plain: true,
		write: (message) => {
			lines.push(message);
		},
	});
	ui.renderMigrationReport(report);
	const text = lines.join("\n");
	assert.match(text, /\[checksum-mismatch\]/);
	assert.equal(text.includes("\u001b["), false);
	assert.equal(text.includes("┌"), false);
});

test("formatAthenaCliError indents code and hint", () => {
	const text = formatAthenaCliError(
		new AthenaCliError({
			code: "HISTORY",
			hint: "Restore the applied file.",
			message: "Application migration history has conflicts.",
		}),
		"/tmp/athena-js.log"
	);
	assert.match(text, /Application migration history has conflicts/);
	assert.match(text, / {2}HISTORY/);
	assert.match(text, / {2}Restore the applied file/);
	assert.match(text, / {2}Log {2}\/tmp\/athena-js\.log/);
});

test("help styling paints section headers and flags when color is on", () => {
	const capabilities = {
		color: true,
		isTty: true,
		mode: "interactive" as const,
		quiet: false,
		verbose: false,
	};
	const help = styleHelpText(
		["athena-js generate", "", "Usage:", "  athena-js generate --dry-run"].join(
			"\n"
		),
		capabilities
	);
	assert.equal(help.includes("\u001b[1mathena-js generate"), true);
	assert.match(help, /┌/);
	assert.match(help, /│/);
	assert.match(help, /└/);
	assert.equal(help.includes("\u001b[36mUsage:"), true);
	assert.equal(help.includes("\u001b[33m--dry-run"), true);
	assert.equal(
		colorizeTaggedLine("[warn] registry target", capabilities).includes(
			"\u001b[33m"
		),
		true
	);
});
