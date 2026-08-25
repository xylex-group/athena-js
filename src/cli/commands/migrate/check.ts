import { defineMigrateCommand } from "./define.ts";

export const migrateCheckCommand = defineMigrateCommand({
	path: ["migrate", "check"],
	mode: "check",
});
