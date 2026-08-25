import { defineMigrateCommand } from "./define.ts";

export const migrateRepairCommand = defineMigrateCommand({
	path: ["migrate", "repair"],
	mode: "repair",
});
