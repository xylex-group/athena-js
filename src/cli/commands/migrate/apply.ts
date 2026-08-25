import { defineMigrateCommand } from "./define.ts";

export const migrateApplyCommand = defineMigrateCommand({
	path: ["migrate"],
	mode: "apply",
});
