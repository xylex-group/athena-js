import { defineMigrateCommand } from "./define.ts";

export const migrateReconcileCommand = defineMigrateCommand({
	path: ["migrate", "reconcile"],
	mode: "reconcile",
});
