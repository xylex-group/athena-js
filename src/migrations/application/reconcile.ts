import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { AthenaCliUI } from "../../cli/ui/index.ts";
import type { CompileMigrationsResult } from "../analysis/index.ts";
import type { MigrationBackend } from "../backend.ts";
import {
	assembleReconciliationReport,
	formatReconciliationReport,
	isHighAutoRepair,
	serializeReconciliationReport,
} from "../reconciliation/index.ts";
import { MigrationError, type RunMigrationsOptions } from "../types.ts";

export async function reconcileApplicationMigrations(input: {
	backend: MigrationBackend;
	cwd: string;
	directoryDisplay: string;
	local: readonly import("../types.ts").MigrationFile[];
	options: RunMigrationsOptions;
	semantic: CompileMigrationsResult;
	ui: AthenaCliUI;
}): Promise<import("../reconciliation/types.ts").ReconciliationReport> {
	const { backend, cwd, directoryDisplay, local, options, semantic, ui } =
		input;
	if (options.applyReconcile) {
		await backend.ensureLedger();
	}
	const archives = (await backend.listArchivedSources?.()) ?? [];
	const reconciliation = await assembleReconciliationReport({
		analyses: semantic.analyses,
		applied: await backend.listAppliedMigrations(),
		archives,
		files: local,
		physical: semantic.physical,
	});
	if (options.json) {
		(options.log ?? console.log)(serializeReconciliationReport(reconciliation));
	} else {
		ui.info(formatReconciliationReport(reconciliation.diagnoses));
		ui.info(reconciliation.summary);
	}
	const eligible = reconciliation.diagnoses.filter(isHighAutoRepair);
	if (options.applyReconcile && eligible.length > 0) {
		if (!options.yes) {
			if (!ui.capabilities.isTty || ui.capabilities.mode !== "interactive") {
				throw new MigrationError(
					"CONFIG",
					[
						reconciliation.summary,
						"",
						"Applying HIGH-confidence metadata repairs requires confirmation.",
						"",
						"  athena-js migrate reconcile --apply --yes",
					].join("\n"),
				);
			}
			const confirmed = await ui.confirm(
				`Apply ${eligible.length} HIGH-confidence metadata repair(s)? Migration SQL will not run.`,
			);
			if (!confirmed) {
				throw new MigrationError("CONFIG", "Reconciliation apply cancelled.");
			}
		}
		for (const diagnosis of eligible) {
			if (diagnosis.action.kind === "repair-ledger") {
				await backend.repairLedgerChecksum?.(
					diagnosis.action.version,
					diagnosis.action.toChecksum,
				);
			}
			if (
				diagnosis.action.kind === "restore-local-source" &&
				diagnosis.archive
			) {
				const filename =
					basename(
						diagnosis.repository?.path ?? diagnosis.archive.sourcePath ?? "",
					) || `${String(diagnosis.version).padStart(4, "0")}_restored.sql`;
				const target =
					diagnosis.repository?.path ??
					resolve(cwd, directoryDisplay, filename);
				if (target && basename(target)) {
					await writeFile(target, diagnosis.archive.sql, "utf8");
				}
			}
			await backend.insertReconciliation?.({
				action: diagnosis.action.kind,
				classification: diagnosis.classification,
				confidence: diagnosis.confidence,
				evidence: diagnosis.evidence,
				newChecksum:
					diagnosis.action.kind === "repair-ledger"
						? diagnosis.action.toChecksum
						: diagnosis.repository?.checksum,
				oldChecksum: diagnosis.ledger?.checksum,
				repositoryCommit: diagnosis.repository?.gitBlobSha,
				version: diagnosis.version,
			});
		}
	}
	return reconciliation;
}
