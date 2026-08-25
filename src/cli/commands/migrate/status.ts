import { defineMigrateCommand } from "./define.ts";

export const migrateStatusCommand = defineMigrateCommand({
	path: ["migrate", "status"],
	mode: "status",
});
